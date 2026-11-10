/* Bridges by condition-state range: small histograms and "more than x%" curves.
   Plain SVG, no dependencies. Exposes window.CSD = { histogram, exceedance, niceTop }.
   Bars and points carry data-i so the page can attach tooltips. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // a round axis top and step for values up to v, with about n steps
  function niceTop(v, n = 4) {
    if (!(v > 0)) return { top: 1, step: 0.25 };
    const raw = v / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-12);
    return { top: Math.ceil(v / step - 1e-9) * step, step };
  }
  const fmtTick = (v) => (Math.abs(v) >= 10 || v === 0 ? String(Math.round(v)) : String(+v.toFixed(2)));

  /* Histogram for one condition state.
     cfg: { values: [21] shares in %, index 0 = exactly 0%, 1 = (0,5], 2 = (5,10] … 20 = (95,100];
            color, zeroColor, axisLabel, ariaLabel, tip(i) -> html } */
  function histogram(box, cfg) {
    const W = Math.max(260, box.clientWidth || 400), narrow = W < 360;
    const H = narrow ? 170 : 190, mL = 40, mR = 8, mT = 16, mB = 36, gap = 8;
    const pw = W - mL - mR - gap, ph = H - mT - mB, slot = pw / 21;
    const vals = cfg.values, zero = vals[0], rest = vals.slice(1);
    const maxRest = Math.max(0, ...rest);
    const ax = niceTop(maxRest > 0 ? maxRest : zero || 1, 4);
    const broken = zero > ax.top * 1.0001; // the 0% bar is taller than the axis: draw it with a break
    const y = (v) => mT + ph - (Math.min(v, ax.top) / ax.top) * ph;
    const xSlot = (i) => mL + (i === 0 ? 0 : gap + i * slot);
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.ariaLabel || "")}">`;
    // grid and y ticks
    for (let t = 0; t <= ax.top + 1e-9; t += ax.step) {
      const yy = y(t).toFixed(1);
      s += `<line class="d-grid" x1="${mL}" x2="${W - mR}" y1="${yy}" y2="${yy}"/><text class="d-tick" x="${mL - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${fmtTick(t)}%</text>`;
    }
    // bars
    for (let i = 0; i < 21; i++) {
      const v = vals[i], x = xSlot(i) + slot * 0.12, w = slot * 0.76;
      const top = y(v), h = Math.max(v > 0 ? 1.5 : 0, mT + ph - top);
      s += `<g class="d-bar" data-i="${i}"><rect class="d-hit" x="${xSlot(i).toFixed(1)}" y="${mT}" width="${slot.toFixed(1)}" height="${ph}"/>`;
      s += `<rect x="${x.toFixed(1)}" y="${(mT + ph - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${i === 0 ? cfg.zeroColor : cfg.color}"/></g>`;
    }
    if (broken) {
      // axis break across the 0% bar; its value is printed beside it below
      const x0 = xSlot(0) + slot * 0.02, x1 = xSlot(0) + slot * 0.98, yb = mT + 10;
      s += `<path class="d-break" d="M${x0.toFixed(1)} ${yb + 3} L${x1.toFixed(1)} ${yb - 3} M${x0.toFixed(1)} ${yb + 8} L${x1.toFixed(1)} ${yb + 2}"/>`;
    }
    if (broken) s += `<text class="d-zero" x="${(xSlot(0) + slot + gap / 2 + 2).toFixed(1)}" y="${mT + 10}">${sig3(zero)}% at 0%</text>`;
    // x axis: "0" under the gray bar, boundaries 25 / 50 / 75 / 100 under the range bars
    const yb = mT + ph;
    s += `<line class="d-axis" x1="${mL}" x2="${W - mR}" y1="${yb}" y2="${yb}"/>`;
    s += `<text class="d-tick" x="${(xSlot(0) + slot / 2).toFixed(1)}" y="${yb + 14}" text-anchor="middle">0</text>`;
    [25, 50, 75, 100].forEach((b) => {
      const xx = mL + gap + (1 + b / 5) * slot;
      s += `<line class="d-axis" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${yb}" y2="${yb + 4}"/><text class="d-tick" x="${xx.toFixed(1)}" y="${yb + 14}" text-anchor="${b === 100 ? "end" : "middle"}">${b}</text>`;
    });
    s += `<text class="d-axlbl" x="${mL + pw / 2 + gap}" y="${H - 4}" text-anchor="middle">${esc(cfg.axisLabel || "")}</text></svg>`;
    box.innerHTML = s;
  }

  /* "More than x%" curves for CS1–CS4 on one chart.
     cfg: { xs: [0, 5, … 95], series: [{ name, color, dash, values: [] }], yLabel, xLabel, ariaLabel,
            tip(i) -> html, onHover(html | null, clientX, clientY) } */
  function exceedance(box, cfg) {
    const W = Math.max(280, box.clientWidth || 600), narrow = W < 420;
    const H = narrow ? 260 : 320, mL = 46, mR = 14, mT = 12, mB = 42;
    const pw = W - mL - mR, ph = H - mT - mB;
    const x = (v) => mL + (v / 100) * pw, y = (v) => mT + ph - (v / 100) * ph;
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.ariaLabel || "")}">`;
    for (let t = 0; t <= 100; t += 25) s += `<line class="d-grid" x1="${mL}" x2="${W - mR}" y1="${y(t)}" y2="${y(t)}"/><text class="d-tick" x="${mL - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`;
    const xt = narrow ? [0, 25, 50, 75, 100] : [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    s += `<line class="d-axis" x1="${mL}" x2="${W - mR}" y1="${mT + ph}" y2="${mT + ph}"/>`;
    xt.forEach((t) => (s += `<line class="d-axis" x1="${x(t)}" x2="${x(t)}" y1="${mT + ph}" y2="${mT + ph + 4}"/><text class="d-tick" x="${x(t)}" y="${mT + ph + 16}" text-anchor="${t === 100 ? "end" : "middle"}">${t}</text>`));
    s += `<text class="d-axlbl" x="${mL + pw / 2}" y="${H - 6}" text-anchor="middle">${esc(cfg.xLabel)}</text>`;
    s += `<text class="d-axlbl" transform="translate(12 ${mT + ph / 2}) rotate(-90)" text-anchor="middle">${esc(cfg.yLabel)}</text>`;
    cfg.series.forEach((sr) => {
      const d = sr.values.map((v, i) => `${i ? "L" : "M"}${x(cfg.xs[i]).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
      s += `<path class="d-line" d="${d}" stroke="${sr.color}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""}/>`;
      sr.values.forEach((v, i) => (s += `<circle class="d-pt" data-i="${i}" cx="${x(cfg.xs[i]).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="${sr.color}"/>`));
    });
    s += `<line class="d-guide" id="dGuide" x1="0" x2="0" y1="${mT}" y2="${mT + ph}" visibility="hidden"/>`;
    s += `<rect class="d-over" x="${mL}" y="${mT}" width="${pw}" height="${ph}"/></svg>`;
    box.innerHTML = s;
    const svg = box.firstChild, over = svg.querySelector(".d-over"), guide = svg.querySelector(".d-guide");
    const pick = (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(cfg.xs.length - 1, Math.round(((px - mL) / pw) * 100 / 5)));
      guide.setAttribute("x1", x(cfg.xs[i])); guide.setAttribute("x2", x(cfg.xs[i])); guide.setAttribute("visibility", "visible");
      svg.querySelectorAll(".d-pt").forEach((c) => c.classList.toggle("on", c.dataset.i === String(i)));
      cfg.onHover && cfg.onHover(cfg.tip(i), ev.clientX, ev.clientY);
    };
    const leave = () => { guide.setAttribute("visibility", "hidden"); svg.querySelectorAll(".d-pt.on").forEach((c) => c.classList.remove("on")); cfg.onHover && cfg.onHover(null); };
    over.addEventListener("mousemove", pick);
    over.addEventListener("click", pick);
    over.addEventListener("mouseleave", leave);
  }

  // 3 significant figures, the same rule as sig3() in index.html
  function sig3(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v === 0) return "0";
    const r = Number(v.toPrecision(3));
    if (r === 0) return "0";
    const mag = Math.floor(Math.log10(Math.abs(r)));
    if (mag >= 3) return Math.round(r).toLocaleString("en-US");
    if (mag < -6) return r.toExponential(2);
    return r.toFixed(Math.max(0, 2 - mag));
  }

  window.CSD = { histogram, exceedance, niceTop };
})();
