/* Deterioration model, computed in the browser from raw inspection records.
 *
 *   share in poor/severe condition  b(t) = 1 − (1 − b0) · e^(−r·t)        t in years
 *
 * Intervals run between consecutive inspections used in the fit; an interval is excluded
 * when the element's total quantity changes between its two inspections. The element-ID
 * rate r ≥ 0 minimises the weighted squared error of each interval's predicted end share
 * (equal weights, 1/n). The forecast starts from the latest inspection and assumes no
 * intervention.
 */
(function (root) {
  "use strict";
  const DAY = 86400000, YEAR_DAYS = 365.25, R_MAX = 1.0;
  const toMs = (d) => Date.parse(d.length === 10 ? d + "T00:00:00Z" : d);
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const project = (b0, r, t) => 1 - (1 - b0) * Math.exp(-r * t);

  function buildIntervals(obs) {
    const used = obs.filter((o) => o.used && o.b != null && isFinite(o.b)).sort((a, b) => toMs(a.d) - toMs(b.d));
    const kept = [], excluded = [];
    for (let i = 1; i < used.length; i++) {
      const s = used[i - 1], e = used[i];
      const years = (toMs(e.d) - toMs(s.d)) / DAY / YEAR_DAYS;
      const base = { start: s, end: e, years };
      if (!(years > 0)) excluded.push({ ...base, reason: "Same inspection date" });
      else if (s.total != null && e.total != null && s.total !== e.total)
        excluded.push({ ...base, reason: "Total quantity changed between inspections" });
      else kept.push(base);
    }
    const w = kept.length ? 1 / kept.length : 0;
    kept.forEach((iv, k) => { iv.n = k + 1; iv.weight = w; });
    return { used, kept, excluded };
  }

  const loss = (ints, r) => ints.reduce((a, iv) => a + iv.weight * (project(iv.start.b, r, iv.years) - iv.end.b) ** 2, 0);

  function fitRate(ints) {
    if (!ints.length) return { r: 0, atUpper: false };
    // coarse scan, then golden-section refinement around the best grid point
    const N = 400; let best = 0, bestL = Infinity;
    for (let i = 0; i <= N; i++) { const r = (R_MAX * i) / N, L = loss(ints, r); if (L < bestL) { bestL = L; best = i; } }
    let a = (R_MAX * Math.max(0, best - 1)) / N, b = (R_MAX * Math.min(N, best + 1)) / N;
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = loss(ints, c), fd = loss(ints, d);
    for (let k = 0; k < 200 && b - a > 1e-14; k++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = loss(ints, c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = loss(ints, d); }
    }
    let r = (a + b) / 2;
    if (loss(ints, 0) <= loss(ints, r)) r = 0;           // boundary optimum (no observed worsening)
    if (r < 1e-9) r = 0;
    return { r, atUpper: R_MAX - r < 1e-6 };
  }

  function run(obs, { horizonYears = 20, steps = 200 } = {}) {
    const { used, kept, excluded } = buildIntervals(obs);
    const { r, atUpper } = fitRate(kept);
    kept.forEach((iv) => {
      iv.pred = project(iv.start.b, r, iv.years);
      iv.errPP = (iv.pred - iv.end.b) * 100;
    });
    const rmsePP = kept.length ? Math.sqrt(loss(kept, r)) * 100 : null;
    const persistencePP = kept.length ? Math.sqrt(kept.reduce((a, iv) => a + iv.weight * (iv.start.b - iv.end.b) ** 2, 0)) * 100 : null;
    const origin = used.find((o) => o.latest) || used[used.length - 1] || null;
    const forecast = [];
    if (origin) {
      const t0 = toMs(origin.d);
      for (let i = 0; i <= steps; i++) {
        const h = (horizonYears * i) / steps;
        forecast.push({ h, t: t0 + h * YEAR_DAYS * DAY, pct: project(origin.b, r, h) * 100 });
      }
    }
    const segment = (iv, n = 24) => {
      const t0 = toMs(iv.start.d);
      return Array.from({ length: n + 1 }, (_, i) => {
        const h = (iv.years * i) / n;
        return { t: t0 + h * YEAR_DAYS * DAY, pct: project(iv.start.b, r, h) * 100 };
      });
    };
    const at = (h) => (origin ? project(origin.b, r, h) * 100 : null);
    return { r, atUpper, used, intervals: kept, excluded, rmsePP, persistencePP, origin, forecast, segment, at, horizonYears };
  }

  /* 3 significant figures, keeping trailing zeros (1.50, 0.200) and avoiding exponent notation. */
  function sig3(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v === 0) return "0";
    const r = Number(v.toPrecision(3));
    if (r === 0) return "0";
    const mag = Math.floor(Math.log10(Math.abs(r)));
    if (mag >= 3) return Math.round(r).toString();
    if (mag < -6) return r.toExponential(2);
    return r.toFixed(Math.max(0, 2 - mag));
  }
  const sig3Signed = (v) => (v == null || !isFinite(v) ? "—" : (v > 0 && sig3(v) !== "0" ? "+" : "") + sig3(v));

  const api = { run, buildIntervals, fitRate, project, sig3, sig3Signed, toMs, isoDate, YEAR_DAYS, DAY, R_MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeteriorationModel = api;
})(typeof window !== "undefined" ? window : globalThis);
