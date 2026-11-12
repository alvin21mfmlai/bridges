/* CS1 → CS2 Weibull model: time an element's quantity stays in the best condition state.
   S(t) = exp(−(t/η)^β) is the expected share of the element quantity still in CS1 at age t.
   Fitted to the observed CS1 share by age band (current-status data: each band tells us what
   share has already left CS1 by that age) by maximising a binomial likelihood, each band
   weighted by its number of bridges.
   Plain JS, no dependencies. Works in the browser (window.WB) and in Node (module.exports). */
(function (root) {
  const S = (t, beta, eta) => Math.exp(-Math.pow(t / eta, beta));

  // Γ(x) by the Lanczos approximation (for the mean time in CS1)
  function gamma(x) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    x -= 1; let a = c[0]; const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
  }

  // 2-parameter Nelder–Mead minimiser
  function nelderMead(f, x0, step = 0.3, iters = 600) {
    let P = [x0, [x0[0] + step, x0[1]], [x0[0], x0[1] + step]].map((p) => ({ p, v: f(p) }));
    const at = (a, b, k) => [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])];
    for (let it = 0; it < iters; it++) {
      P.sort((a, b) => a.v - b.v);
      if (Math.abs(P[2].v - P[0].v) < 1e-12 * (1 + Math.abs(P[0].v)) && it > 50) break;
      const c = at(P[0].p, P[1].p, 0.5), r = at(c, P[2].p, -1), vr = f(r);
      if (vr < P[0].v) { const e = at(c, P[2].p, -2), ve = f(e); P[2] = ve < vr ? { p: e, v: ve } : { p: r, v: vr }; }
      else if (vr < P[1].v) P[2] = { p: r, v: vr };
      else {
        const k = at(c, P[2].p, 0.5), vk = f(k);
        if (vk < P[2].v) P[2] = { p: k, v: vk };
        else P = [P[0], ...P.slice(1).map((q) => { const p = at(P[0].p, q.p, 0.5); return { p, v: f(p) }; })];
      }
    }
    P.sort((a, b) => a.v - b.v);
    return P[0].p;
  }

  /* points: [{ t: age (years), p: observed share in CS1 (0–1), w: weight (bridges) }]
     returns { beta, eta, median, mean, rmse, departed } or { departed: false } when nothing
     has left CS1 yet (no curve can be fitted), or null with no data. */
  function fit(points) {
    const pts = points.filter((d) => d.w > 0 && d.t > 0 && isFinite(d.p));
    if (!pts.length) return null;
    if (pts.every((d) => d.p >= 1 - 1e-6)) return { departed: false };
    const LB = [Math.log(0.1), Math.log(20)], LE = [Math.log(1), Math.log(1e4)];
    const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
    const nll = ([lb, le]) => {
      const b = Math.exp(clamp(lb, LB)), e = Math.exp(clamp(le, LE));
      let L = 0;
      for (const d of pts) {
        const s = Math.min(1 - 1e-12, Math.max(1e-12, S(d.t, b, e)));
        L -= d.w * (d.p * Math.log(s) + (1 - d.p) * Math.log(1 - s));
      }
      // keep the search inside the bounds
      return L + 1e3 * (Math.abs(lb - clamp(lb, LB)) + Math.abs(le - clamp(le, LE)));
    };
    // start from a weighted straight-line fit of ln(−ln p) on ln t
    let W = 0, mx = 0, my = 0;
    const lin = pts.map((d) => { const p = Math.min(0.995, Math.max(0.005, d.p)); return { x: Math.log(d.t), y: Math.log(-Math.log(p)), w: d.w }; });
    lin.forEach((d) => { W += d.w; mx += d.w * d.x; my += d.w * d.y; }); mx /= W; my /= W;
    let sxy = 0, sxx = 0; lin.forEach((d) => { sxy += d.w * (d.x - mx) * (d.y - my); sxx += d.w * (d.x - mx) ** 2; });
    let b0 = sxx > 0 ? sxy / sxx : 1; if (!(b0 > 0.1)) b0 = 1;
    const e0 = Math.exp(mx - my / b0);
    const [lb, le] = nelderMead(nll, [clamp(Math.log(b0), LB), clamp(Math.log(isFinite(e0) ? e0 : 50), LE)]);
    const beta = Math.exp(clamp(lb, LB)), eta = Math.exp(clamp(le, LE));
    let se = 0; pts.forEach((d) => (se += d.w * (d.p - S(d.t, beta, eta)) ** 2));
    return {
      departed: true, beta, eta,
      median: eta * Math.pow(Math.LN2, 1 / beta),
      mean: eta * gamma(1 + 1 / beta),
      rmse: Math.sqrt(se / pts.reduce((a, d) => a + d.w, 0)),
    };
  }

  /* Chart: observed CS1 share by age band (dots sized by bridges, joined by a line) and the
     fitted curve from 0 to 100 years, with the median marked when it is inside the range.
     cfg: { points: [{ t, p, w, label }], model (from fit), tip(i) -> html, onHover(html|null, x, y),
            ariaLabel } */
  function chart(box, cfg) {
    const NS = "http://www.w3.org/2000/svg";
    const W = Math.max(300, box.clientWidth || 700), narrow = W < 520;
    const H = narrow ? 280 : 340, mL = 52, mR = 16, mT = 14, mB = 44;
    const pw = W - mL - mR, ph = H - mT - mB;
    const x = (t) => mL + (t / 100) * pw, y = (p) => mT + ph - p * ph;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.ariaLabel || "")}">`;
    for (let p = 0; p <= 1.0001; p += 0.2) s += `<line class="d-grid" x1="${mL}" x2="${W - mR}" y1="${y(p)}" y2="${y(p)}"/><text class="d-tick" x="${mL - 6}" y="${y(p) + 4}" text-anchor="end">${p.toFixed(1)}</text>`;
    s += `<line class="d-axis" x1="${mL}" x2="${W - mR}" y1="${mT + ph}" y2="${mT + ph}"/>`;
    for (let t = 0; t <= 100; t += narrow ? 20 : 10) s += `<line class="d-axis" x1="${x(t)}" x2="${x(t)}" y1="${mT + ph}" y2="${mT + ph + 4}"/><text class="d-tick" x="${x(t)}" y="${mT + ph + 16}" text-anchor="${t === 100 ? "end" : "middle"}">${t}</text>`;
    s += `<text class="d-axlbl" x="${mL + pw / 2}" y="${H - 6}" text-anchor="middle">Element age (years)</text>`;
    s += `<text class="d-axlbl" transform="translate(13 ${mT + ph / 2}) rotate(-90)" text-anchor="middle">Proportion remaining in CS1</text>`;
    const m = cfg.model;
    if (m && m.departed) {
      if (m.median <= 100) {
        s += `<path class="wb-med" d="M${mL} ${y(0.5)} H${x(m.median).toFixed(1)} V${mT + ph}"/>`;
        // The curve is above 0.5 before the median and below it after, so the label goes where the
        // curve is not: above-right of the guide, or below-left when the median is near the axis end.
        const left = x(m.median) > mL + pw * 0.7;
        s += `<text class="wb-medlbl" x="${(x(m.median) + (left ? -6 : 6)).toFixed(1)}" y="${(y(0.5) + (left ? 16 : -6)).toFixed(1)}" text-anchor="${left ? "end" : "start"}">Median ${cfg.fmt(m.median)} years</text>`;
      }
      let d = "";
      for (let t = 0; t <= 100; t += 0.5) d += `${t ? "L" : "M"}${x(t).toFixed(1)} ${y(S(t, m.beta, m.eta)).toFixed(1)}`;
      s += `<path class="wb-fit" d="${d}"/>`;
    }
    const pts = cfg.points, wMax = Math.max(1, ...pts.map((d) => d.w));
    if (pts.length > 1) s += `<path class="wb-obs" d="${pts.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)} ${y(d.p).toFixed(1)}`).join("")}"/>`;
    pts.forEach((d, i) => (s += `<circle class="wb-dot" data-i="${i}" cx="${x(d.t).toFixed(1)}" cy="${y(d.p).toFixed(1)}" r="${(2.5 + 5 * Math.sqrt(d.w / wMax)).toFixed(1)}"/>`));
    s += `<line class="d-guide" x1="0" x2="0" y1="${mT}" y2="${mT + ph}" visibility="hidden"/>`;
    s += `<rect class="d-over" x="${mL}" y="${mT}" width="${pw}" height="${ph}"/></svg>`;
    box.innerHTML = s;
    if (!pts.length) return;
    const svg = box.firstChild, over = svg.querySelector(".d-over"), guide = svg.querySelector(".d-guide");
    const pick = (ev) => {
      const r = svg.getBoundingClientRect(), t = (((ev.clientX - r.left) / r.width) * W - mL) / pw * 100;
      let i = 0; pts.forEach((d, j) => { if (Math.abs(d.t - t) < Math.abs(pts[i].t - t)) i = j; });
      guide.setAttribute("x1", x(pts[i].t)); guide.setAttribute("x2", x(pts[i].t)); guide.setAttribute("visibility", "visible");
      svg.querySelectorAll(".wb-dot").forEach((c) => c.classList.toggle("on", c.dataset.i === String(i)));
      cfg.onHover && cfg.onHover(cfg.tip(i), ev.clientX, ev.clientY);
    };
    over.addEventListener("mousemove", pick);
    over.addEventListener("click", pick);
    over.addEventListener("mouseleave", () => { guide.setAttribute("visibility", "hidden"); svg.querySelectorAll(".wb-dot.on").forEach((c) => c.classList.remove("on")); cfg.onHover && cfg.onHover(null); });
  }

  const api = { S, fit, chart, gamma };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WB = api;
})(typeof window !== "undefined" ? window : this);
