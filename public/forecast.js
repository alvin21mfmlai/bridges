/* BHI forecast: where each bridge's health score is heading if nothing is repaired.

   Models. For every element type of a state and period, Prediction Methods #1 and #2 are fitted
   exactly as in Basic Analytics (weibull.js, markov.js), from the qty lists in data/<ST>/fit.json.

   Start. The forecast covers the bridges with a health score in the period's last data year E.
   Each element record on such a bridge in year E (data/<ST>/loc/<EN>.json, the same records the
   health score counts: positive quantity, quantity check passed, a unit) starts from its CS1–CS4
   quantities at its age in E.

   Stepping. Each year the element ages by one year, as in Prediction Method #2:
     CS1 → CS2 with p12(a) = 1 − S(a+1)/S(a)  (Prediction Method #1)
     CS2 → CS3 with p23 and CS3 → CS4 with p34 of the element's 20-year age group (Prediction Method #2)
   where a is the element's age in that year (ages over 100 use the 81–100 group).
   Element types with too little data (fewer than MIN_BRIDGES bridges or MIN_BANDS age bands), or
   for which Prediction Method #2 cannot be fitted, and elements of unknown age keep their condition.

   Scores. For each bridge, future year k = 0 … YEARS and unit (sq ft, ft, each) the forecast keeps
   N = Σ(100 CS1 + 67 CS2 + 33 CS3) and the total quantity Q, so the score works for any unit costs:
   F_k = Σ(cost × N_k) ÷ Σ(cost × Q). The loc files keep CS shares in 0.1% and quantities to 3
   significant figures, so F_0 is close to but not exactly the bridge's health score S_E. The
   forecast therefore adds the predicted change to the exact score: forecast_k = S_E + F_k − F_0.

   The forecast assumes no repairs, rehabilitation or replacement, so a score never goes up.

   Back-check (backcheck): the same forecast started at the period's first year and compared,
   year by year, with the actual scores of one fixed set of bridges (those with data in both years).
   Plain JS, no dependencies. Works in the browser (window.FC) and in Node (module.exports). */
(function (root) {
  const YEARS = 10, MIN_BRIDGES = 20, MIN_BANDS = 3, STEP = YEARS + 1;
  const AGE_LO = []; for (let lo = 1; lo <= 100; lo += 5) AGE_LO.push(lo); // 5-year age bands, as in index.html
  const COUNTED = [true, false, false, true, true]; // loc ex codes the health score counts: none, no deck area, no age

  // element quantity per age band for period [s, e]: the same sums as periodData() in index.html
  function bands(qtyByEnd, s, e) {
    const groups = qtyByEnd[e]; if (!groups) return null;
    const out = AGE_LO.map(() => ({ n: 0, q: [0, 0, 0, 0] }));
    for (const g in groups) {
      if (+g < s) continue;
      const q = groups[g];
      for (let i = 0; i < q.length; i += 6) { const r = out[q[i]]; r.n += q[i + 1]; for (let k = 0; k < 4; k++) r.q[k] += q[i + 2 + k]; }
    }
    return out;
  }

  /* Prediction Methods #1 and #2 for one element type and period, with the same points as
     buildWeibull() and buildMarkov() in index.html. Returns { ok, beta, eta, p23c, p34c, bridges,
     bands, why } where why says what is missing when ok is false. */
  function fitElement(qtyByEnd, s, e, WB, MK) {
    const qty = bands(qtyByEnd, s, e);
    if (!qty) return { ok: false, bridges: 0, bands: 0, why: "no_data" };
    const points = [];
    qty.forEach((r, u) => {
      const tot = r.q[0] + r.q[1] + r.q[2] + r.q[3];
      if (r.n && tot > 0) points.push({ u, t: AGE_LO[u] + 2, p: r.q[0] / tot, w: r.n, q1: r.q[0], tot, obs: r.q.map((v) => v / tot), q: r.q.slice() });
    });
    const bridges = points.reduce((a, d) => a + d.w, 0), nb = points.length;
    const res = { ok: false, bridges, bands: nb, why: "" };
    if (bridges < MIN_BRIDGES) { res.why = "few_bridges"; return res; }
    if (nb < MIN_BANDS) { res.why = "few_bands"; return res; }
    const w = WB.fit(points);
    if (!w || !w.departed) { res.why = "method1"; return res; }
    const m = MK.fit(points, w);
    if (!m) { res.why = "method2"; return res; }
    return { ok: true, beta: w.beta, eta: w.eta, p23c: m.p23c, p34c: m.p34c, bridges, bands: nb, why: "" };
  }

  /* One element from its CS quantities c = [CS1, CS2, CS3, CS4] at age a0, stepped YEARS years.
     Adds 100 CS1 + 67 CS2 + 33 CS3 of year k into out[off + 3k]. Without a model, or with an
     unknown age (a0 null), the condition stays as it is. Same step as propagate() in markov.js. */
  function project(c, a0, m, MK, out, off) {
    let c1 = c[0], c2 = c[1], c3 = c[2], c4 = c[3];
    out[off] += 100 * c1 + 67 * c2 + 33 * c3;
    const live = m && m.ok && a0 != null;
    for (let k = 1; k <= YEARS; k++) {
      if (live) {
        const a = Math.max(0, a0 + k - 1), cat = MK.catOf(a);
        const p12 = MK.annualP(a, m.beta, m.eta), p23 = m.p23c[cat], p34 = m.p34c[cat];
        const n1 = c1 * (1 - p12), n2 = c1 * p12 + c2 * (1 - p23), n3 = c2 * p23 + c3 * (1 - p34), n4 = c3 * p34 + c4;
        c1 = n1; c2 = n2; c3 = n3; c4 = n4;
      }
      out[off + 3 * k] += 100 * c1 + 67 * c2 + 33 * c3;
    }
  }

  /* The forecast's starting set: every bridge with a score in year E.
     h: the health data as loadHealth() in index.html builds it ({ base, NY, n, S, yb }).
     Returns F = { E, pop (bridge index b per forecast bridge j), idx (j per b, −1 if not in it),
     N (j·33 + 3k + u), Q (j·3 + u), qAll, qHeld (quantity per unit, all and kept as it is),
     elements, held (element records, all and kept as they are), skipped (element types) }. */
  function start(h, E) {
    const y = E - h.base, pop = [], idx = new Int32Array(h.n).fill(-1);
    if (y >= 0 && y < h.NY) for (let b = 0; b < h.n; b++) if (h.S[b * h.NY + y] >= 0) { idx[b] = pop.length; pop.push(b); }
    const np = pop.length;
    return { E, pop: Int32Array.from(pop), idx, N: new Float64Array(np * 3 * STEP), Q: new Float64Array(np * 3),
      qAll: [0, 0, 0], qHeld: [0, 0, 0], elements: 0, held: 0, types: 0, typesHeld: 0, skipped: [] };
  }

  /* Add one element type's records in year E. d: its loc file as loaded. u: the index of its unit in
     h.units (sq ft, ft, each). m: its fitted models from fitElement(). row → b comes from h.of. */
  function addElement(F, h, d, u, m, MK) {
    const eo = F.E - d.base, q4 = [0, 0, 0, 0];
    let row = 0, k = 0, n = 0, held = 0;
    for (let i = 0; i < d.row.length; i++) {
      row += d.row[i];
      const runs = d.nrun[i], b = h.of.get(row), j = b == null ? -1 : F.idx[b];
      if (j < 0) { k += runs; continue; }
      for (let r = 0; r < runs; r++, k++) {
        const y0 = Math.floor(d.yy[k] / 100), y1 = d.yy[k] % 100;
        if (y0 > eo || y1 < eo || !COUNTED[d.ex[k]] || !(d.q[k] > 0)) continue;
        const q = d.q[k], s1 = d.s1[k], s2 = d.s2[k], s3 = d.s3[k];
        q4[0] = (q * s1) / 1000; q4[1] = (q * s2) / 1000; q4[2] = (q * s3) / 1000; q4[3] = (q * Math.max(0, 1000 - s1 - s2 - s3)) / 1000;
        // year built: the record's own, else the bridge's (from its latest year with an age)
        const yb = d.yb[k] || h.yb[b] || 0, a0 = yb ? F.E - yb : null;
        project(q4, a0, m, MK, F.N, j * 3 * STEP + u);
        F.Q[j * 3 + u] += q; F.qAll[u] += q; n++;
        if (!(m && m.ok) || a0 == null) { F.qHeld[u] += q; held++; }
      }
    }
    F.elements += n; F.held += held;
    if (n) { F.types++; if (!(m && m.ok)) F.typesHeld++; }
    return n;
  }

  // a bridge's forecast scores for years E … E+YEARS at costs c, rounded to 0.1 like the health scores
  function bridge(F, h, j, c, out) {
    const b = F.pop[j], s0 = h.S[b * h.NY + F.E - h.base] / 10, iQ = j * 3, i0 = j * 3 * STEP;
    let w = 0; for (let u = 0; u < 3; u++) w += c[u] * F.Q[iQ + u];
    let f0 = 0; if (w > 0) for (let u = 0; u < 3; u++) f0 += c[u] * F.N[i0 + u];
    for (let k = 0; k <= YEARS; k++) {
      let x = 0; if (w > 0) for (let u = 0; u < 3; u++) x += c[u] * F.N[i0 + 3 * k + u];
      const v = w > 0 ? s0 + (x - f0) / w : s0;
      out[k] = Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
    }
    return out;
  }

  /* Back-check: B is a forecast started at an earlier year B.E (the period's first year), with
     the same models. It follows one fixed set of bridges: those of B that also have a score in the
     last year, so the set never changes from year to year. For each year y from B.E to `last` it
     gives, over the bridges of that set with a score in year y, the average predicted score and the
     average actual score. Returns { m (bridges in the set), D: [{ y, n, pred, act }] }.
     The models are fitted to the same period, so this checks how well they reproduce what
     happened, not an independent test. */
  function backcheck(B, h, c, last) {
    const K = Math.min(YEARS, last - B.E), tmp = new Float64Array(STEP);
    const P = new Float64Array(K + 1), A = new Float64Array(K + 1), N = new Int32Array(K + 1);
    let m = 0;
    for (let j = 0; j < B.pop.length; j++) {
      const b = B.pop[j];
      if (h.S[b * h.NY + last - h.base] < 0) continue; // not in the last year, so not in the set
      m++;
      bridge(B, h, j, c, tmp);
      for (let k = 0; k <= K; k++) {
        const a = h.S[b * h.NY + B.E + k - h.base];
        if (a < 0) continue;
        P[k] += tmp[k]; A[k] += a / 10; N[k]++;
      }
    }
    const D = [];
    for (let k = 0; k <= K; k++) if (N[k]) D.push({ y: B.E + k, n: N[k], pred: P[k] / N[k], act: A[k] / N[k] });
    return { m, D };
  }

  // linear-interpolation percentile of sorted values (as PERCENTILE.INC and quant() in index.html)
  function quant(v, p) {
    if (!v.length) return null;
    const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  }

  /* For each year E … E+YEARS at costs c: { y, n, mean, p05, p25, p50, p75, below (share under 70%),
     bands [share 95+, 85–95, 70–85, under 70] }, and the share of weighted quantity kept as it is. */
  function stats(F, h, c) {
    const np = F.pop.length, V = Array.from({ length: STEP }, () => new Float64Array(np)), tmp = new Float64Array(STEP);
    for (let j = 0; j < np; j++) { bridge(F, h, j, c, tmp); for (let k = 0; k < STEP; k++) V[k][j] = tmp[k]; }
    const D = V.map((v, k) => {
      v.sort();
      let sum = 0; const bd = [0, 0, 0, 0];
      for (let j = 0; j < np; j++) { const x = v[j]; sum += x; bd[x >= 95 ? 0 : x >= 85 ? 1 : x >= 70 ? 2 : 3]++; }
      return { y: F.E + k, n: np, mean: np ? sum / np : null, p05: quant(v, 0.05), p25: quant(v, 0.25), p50: quant(v, 0.5), p75: quant(v, 0.75),
        below: np ? bd[3] / np : null, bands: bd.map((x) => (np ? x / np : 0)) };
    });
    let wa = 0, wh = 0; for (let u = 0; u < 3; u++) { wa += c[u] * F.qAll[u]; wh += c[u] * F.qHeld[u]; }
    return { D, heldShare: wa > 0 ? wh / wa : 0 };
  }

  const api = { YEARS, MIN_BRIDGES, MIN_BANDS, bands, fitElement, project, start, addElement, bridge, stats, backcheck, quant };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FC = api;
})(typeof window !== "undefined" ? window : globalThis);
