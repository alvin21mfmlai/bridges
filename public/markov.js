/* CS2 → CS3 → CS4 Markov model: movement through progressively worse condition states.
   A yearly Markov chain on the share of element quantity in CS1–CS4. Each year of age a:
     CS1 → CS2 with probability p12(a), CS2 → CS3 with p23(a), CS3 → CS4 with p34(a); CS4 stays.
   - p12(a) comes from the CS1 → CS2 Weibull fit (weibull.js): p12(a) = 1 − S(a+1)/S(a),
     so both analyses agree.
   - p23 and p34 are constant within each 20-year age category (1–20, 21–40 … 81–100): one
     transition probability matrix per age category.
   - They are fitted so that the predicted CS1–CS4 mix at each age matches the observed mix in
     each 5-year age band: multinomial likelihood, each band weighted by its bridges, with a small
     penalty on jumps between neighbouring categories so that thinly populated categories stay
     stable. Probabilities are kept between 0.001% and 50% a year.
   Plain JS, no dependencies. Works in the browser (window.MK) and in Node (module.exports). */
(function (root) {
  const AGE_MAX = 100;
  const CATS = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]]; // steps from age a to a+1, a in [lo, hi)
  const CAT_LABELS = ["1–20", "21–40", "41–60", "61–80", "81–100"];
  const catOf = (a) => Math.min(CATS.length - 1, Math.floor(a / 20));
  const annualP = (a, beta, eta) => 1 - Math.exp(-(Math.pow((a + 1) / eta, beta) - Math.pow(a / eta, beta)));
  const logit = (p) => Math.log(p / (1 - p)), inv = (z) => 1 / (1 + Math.exp(-z));
  const LO = logit(1e-5), HI = logit(0.5);

  // shares in CS1–CS4 at every whole age 0 … 100, starting all in CS1 when new
  function propagate(p12, p23c, p34c) {
    const x = [[1, 0, 0, 0]];
    for (let a = 0; a < AGE_MAX; a++) {
      const [c1, c2, c3, c4] = x[a], q12 = p12[a], q23 = p23c[catOf(a)], q34 = p34c[catOf(a)];
      x.push([c1 * (1 - q12), c1 * q12 + c2 * (1 - q23), c2 * q23 + c3 * (1 - q34), c3 * q34 + c4]);
    }
    return x;
  }

  // the 4×4 annual transition probability matrix for age category c (rows: from, columns: to)
  function tpm(m, c) {
    const p12 = m.p12c[c], p23 = m.p23c[c], p34 = m.p34c[c];
    return [[1 - p12, p12, 0, 0], [0, 1 - p23, p23, 0], [0, 0, 1 - p34, p34], [0, 0, 0, 1]];
  }

  // n-dimensional Nelder–Mead minimiser
  function nelderMead(f, x0, step = 0.4, iters = 2000) {
    const n = x0.length;
    let P = [x0.slice()];
    for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step; P.push(p); }
    P = P.map((p) => ({ p, v: f(p) }));
    const comb = (a, b, k) => a.map((v, i) => v + k * (b[i] - v));
    for (let it = 0; it < iters; it++) {
      P.sort((a, b) => a.v - b.v);
      if (it > 100 && Math.abs(P[n].v - P[0].v) < 1e-10 * (1 + Math.abs(P[0].v))) break;
      const c = P.slice(0, n).reduce((acc, q) => acc.map((v, i) => v + q.p[i] / n), Array(n).fill(0));
      const r = comb(c, P[n].p, -1), vr = f(r);
      if (vr < P[0].v) { const e = comb(c, P[n].p, -2), ve = f(e); P[n] = ve < vr ? { p: e, v: ve } : { p: r, v: vr }; }
      else if (vr < P[n - 1].v) P[n] = { p: r, v: vr };
      else {
        const k = comb(c, P[n].p, 0.5), vk = f(k);
        if (vk < P[n].v) P[n] = { p: k, v: vk };
        else P = [P[0], ...P.slice(1).map((q) => { const p = comb(P[0].p, q.p, 0.5); return { p, v: f(p) }; })];
      }
    }
    P.sort((a, b) => a.v - b.v);
    return P[0].p;
  }

  /* points: [{ t: age, obs: [s1, s2, s3, s4] shares, w: bridges }]
     cs1: { beta, eta } from the Weibull fit.
     returns { p12 (annual, ages 0–99), p12c, p23c, p34c (per category), x (shares by age 0–100),
               rmse } or null */
  function fit(points, cs1, opts = {}) {
    const pts = points.filter((d) => d.w > 0 && d.t > 0 && d.t <= AGE_MAX);
    if (!pts.length || !cs1) return null;
    const lambda = opts.lambda ?? 0.003, nC = CATS.length;
    const p12 = Array.from({ length: AGE_MAX }, (_, a) => annualP(a, cs1.beta, cs1.eta));
    const W = pts.reduce((s, d) => s + d.w, 0);
    const unpack = (z) => [z.slice(0, nC).map(inv), z.slice(nC).map(inv)];
    const nll = (z) => {
      const [a, b] = unpack(z), x = propagate(p12, a, b);
      let L = 0;
      // CS1 is set by the Weibull fit; CS2–CS4 carry the information about p23 and p34
      for (const d of pts) for (let k = 1; k < 4; k++) if (d.obs[k] > 0) L -= d.w * d.obs[k] * Math.log(Math.max(1e-12, x[d.t][k]));
      let pen = 0, out = 0;
      for (let c = 1; c < nC; c++) pen += (z[c] - z[c - 1]) ** 2 + (z[nC + c] - z[nC + c - 1]) ** 2;
      z.forEach((v) => { if (v > HI) out += (v - HI) ** 2; if (v < LO) out += (LO - v) ** 2; });
      return L + lambda * W * pen + 1e3 * W * out;
    };
    // start from the best constant pair on a small grid, then Nelder–Mead in logit space
    let z = null, best = Infinity;
    for (const s2 of [1e-3, 3e-3, 0.01, 0.03, 0.08]) for (const s3 of [1e-3, 3e-3, 0.01, 0.03, 0.08]) {
      const zz = [...Array(nC).fill(logit(s2)), ...Array(nC).fill(logit(s3))], v = nll(zz);
      if (v < best) { best = v; z = zz; }
    }
    for (let r = 0; r < 4; r++) z = nelderMead(nll, z, r ? 0.3 : 0.8, 4000);
    const [p23c, p34c] = unpack(z).map((arr) => arr.map((p) => Math.min(0.5, Math.max(1e-5, p))));
    const x = propagate(p12, p23c, p34c);
    const p12c = CATS.map(([lo, hi]) => { let s = 0; for (let a = lo; a < hi; a++) s += p12[a]; return s / (hi - lo); });
    let se = 0;
    for (const d of pts) for (let k = 0; k < 4; k++) se += d.w * (d.obs[k] - x[d.t][k]) ** 2;
    return { p12, p12c, p23c, p34c, x, rmse: Math.sqrt(se / (4 * W)) };
  }

  /* Line chart with optional observed dots, in plain SVG.
     cfg: { xMax, yMax (auto if absent), yFmt, xLabel, yLabel, series: [{ name, color, dash, line: [[x,y]…],
            dots: [[x,y,i]…] }], hoverXs: [x…], tip(j) -> html, onHover(html|null, cx, cy), ariaLabel } */
  function lineChart(box, cfg) {
    const NS = "http://www.w3.org/2000/svg";
    const W = Math.max(300, box.clientWidth || 700), narrow = W < 520;
    const H = narrow ? 260 : 320, mL = 52, mR = 16, mT = 14, mB = 44;
    const pw = W - mL - mR, ph = H - mT - mB;
    let yMax = cfg.yMax;
    if (!yMax) {
      const top = Math.max(1e-6, ...cfg.series.flatMap((s) => [...(s.line || []), ...(s.dots || [])].map((p) => p[1])));
      const raw = top / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw - 1e-12);
      yMax = Math.ceil(top / step - 1e-9) * step;
    }
    const yStep = yMax / 5;
    const x = (v) => mL + (v / cfg.xMax) * pw, y = (v) => mT + ph - (Math.min(v, yMax) / yMax) * ph;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.ariaLabel || "")}">`;
    for (let i = 0; i <= 5; i++) { const v = i * yStep; s += `<line class="d-grid" x1="${mL}" x2="${W - mR}" y1="${y(v)}" y2="${y(v)}"/><text class="d-tick" x="${mL - 6}" y="${y(v) + 4}" text-anchor="end">${cfg.yFmt(v)}</text>`; }
    s += `<line class="d-axis" x1="${mL}" x2="${W - mR}" y1="${mT + ph}" y2="${mT + ph}"/>`;
    for (let t = 0; t <= cfg.xMax; t += narrow ? 20 : 10) s += `<line class="d-axis" x1="${x(t)}" x2="${x(t)}" y1="${mT + ph}" y2="${mT + ph + 4}"/><text class="d-tick" x="${x(t)}" y="${mT + ph + 16}" text-anchor="${t === cfg.xMax ? "end" : "middle"}">${t}</text>`;
    s += `<text class="d-axlbl" x="${mL + pw / 2}" y="${H - 6}" text-anchor="middle">${esc(cfg.xLabel)}</text>`;
    s += `<text class="d-axlbl" transform="translate(13 ${mT + ph / 2}) rotate(-90)" text-anchor="middle">${esc(cfg.yLabel)}</text>`;
    cfg.series.forEach((sr) => {
      if (sr.line && sr.line.length) s += `<path class="mk-line" d="${sr.line.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("")}" stroke="${sr.color}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""}/>`;
      (sr.dots || []).forEach((p) => (s += `<circle class="mk-dot" cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${p[3] || 3.4}" fill="${sr.fill || sr.color}" stroke="${sr.color}"/>`));
    });
    s += `<line class="d-guide" x1="0" x2="0" y1="${mT}" y2="${mT + ph}" visibility="hidden"/>`;
    s += `<rect class="d-over" x="${mL}" y="${mT}" width="${pw}" height="${ph}"/></svg>`;
    box.innerHTML = s;
    const xs = cfg.hoverXs || [];
    if (!xs.length) return;
    const svg = box.firstChild, over = svg.querySelector(".d-over"), guide = svg.querySelector(".d-guide");
    const pick = (ev) => {
      const r = svg.getBoundingClientRect(), t = ((((ev.clientX - r.left) / r.width) * W - mL) / pw) * cfg.xMax;
      let j = 0; xs.forEach((v, k) => { if (Math.abs(v - t) < Math.abs(xs[j] - t)) j = k; });
      guide.setAttribute("x1", x(xs[j])); guide.setAttribute("x2", x(xs[j])); guide.setAttribute("visibility", "visible");
      cfg.onHover && cfg.onHover(cfg.tip(j), ev.clientX, ev.clientY);
    };
    over.addEventListener("mousemove", pick);
    over.addEventListener("click", pick);
    over.addEventListener("mouseleave", () => { guide.setAttribute("visibility", "hidden"); cfg.onHover && cfg.onHover(null); });
  }

  const api = { annualP, tpm, propagate, fit, lineChart, nelderMead, AGE_MAX, CATS, CAT_LABELS, catOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MK = api;
})(typeof window !== "undefined" ? window : this);
