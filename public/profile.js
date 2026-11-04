/* Condition-state profile of an element type, computed in the browser.
 *
 * For each bridge, the latest selected element members are summed into CS1–CS4 quantities.
 * Each bridge then falls into one cell per condition state:
 *   age bin  = profile year − year built, in 5-year bins 1–5, 6–10, …, 96–100
 *   CS% bin  = CSk quantity / total quantity × 100, in 5% bins [0,5], (5,10], …, (95,100]
 * A cell's value is the total deck area of the bridges in it; each bridge counts its full
 * deck area once per condition-state figure.
 */
(function (root) {
  "use strict";
  const CS = ["CS1", "CS2", "CS3", "CS4"];
  const EPS = 1e-9;

  function bins(meta) {
    const [aMin, aMax] = String(meta.ageRange || "1-100").match(/\d+/g).map(Number);
    const aw = meta.ageBinWidth || 5, cw = meta.csBinWidth || 5;
    const age = [];
    for (let lo = aMin; lo <= aMax; lo += aw) age.push({ lo, hi: Math.min(aMax, lo + aw - 1), label: `${lo}–${Math.min(aMax, lo + aw - 1)}` });
    const cs = [];
    for (let lo = 0; lo < 100; lo += cw) cs.push({ lo, hi: lo + cw, label: lo === 0 ? `0–${cw}` : `>${lo}–${lo + cw}` });
    return { age, cs, aMin, aMax, aw, cw };
  }
  const ageIndex = (age, B) => (age < B.aMin || age > B.aMax ? -1 : Math.floor((age - B.aMin) / B.aw));
  const csIndex = (pct, B) => { const p = Math.round(pct / EPS) * EPS; return p <= B.cw ? 0 : Math.min(B.cs.length - 1, Math.ceil(p / B.cw - EPS) - 1); };

  /* members: [{bridge, element, date, total, cs:[4], yearBuilt, deckArea, status}] */
  function compute(profile) {
    const meta = profile.meta, B = bins(meta);
    const byBridge = new Map();
    for (const m of profile.members) {
      if (m.status && m.status !== "included") continue;
      let b = byBridge.get(m.bridge);
      if (!b) byBridge.set(m.bridge, (b = { id: m.bridge, elements: [], dates: [], total: 0, cs: [0, 0, 0, 0], yearBuilt: m.yearBuilt, deckArea: m.deckArea }));
      b.elements.push(m.element); b.dates.push(m.date);
      b.total += m.total || 0;
      m.cs.forEach((q, k) => (b.cs[k] += q || 0));
    }
    const bridges = [], excluded = [];
    for (const b of byBridge.values()) {
      b.age = meta.profileYear - b.yearBuilt;
      b.pct = b.cs.map((q) => (b.total > 0 ? (q / b.total) * 100 : null));
      b.ageIdx = ageIndex(b.age, B);
      if (!(b.total > 0)) excluded.push({ ...b, reason: "No element quantity" });
      else if (!(b.deckArea > 0)) excluded.push({ ...b, reason: "No deck area" });
      else if (b.ageIdx < 0) excluded.push({ ...b, reason: `Age ${b.age} outside ${B.aMin}–${B.aMax} years` });
      else { b.csIdx = b.pct.map((p) => csIndex(p, B)); bridges.push(b); }
    }
    bridges.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    const cells = CS.map((_, k) => {
      const map = new Map();
      for (const b of bridges) {
        const key = `${b.ageIdx},${b.csIdx[k]}`;
        let c = map.get(key);
        if (!c) map.set(key, (c = { u: b.ageIdx, v: b.csIdx[k], area: 0, bridges: [] }));
        c.area += b.deckArea; c.bridges.push(b);
      }
      return [...map.values()];
    });
    const maxArea = Math.max(0, ...cells.flat().map((c) => c.area));
    const totalArea = bridges.reduce((a, b) => a + b.deckArea, 0);
    return { meta, bins: B, bridges, excluded, cells, maxArea, totalArea, CS };
  }

  /* Compare computed cells with the pipeline's bins.csv (non-empty rows only). */
  function matchesPipeline(P, pipelineBins) {
    if (!pipelineBins) return null;
    const got = new Map();
    P.cells.forEach((cs, k) => cs.forEach((c) => got.set(`${P.CS[k]}|${P.bins.age[c.u].lo}|${P.bins.cs[c.v].lo}`, c)));
    if (got.size !== pipelineBins.length) return false;
    return pipelineBins.every((r) => {
      const c = got.get(`${r.cs}|${r.ageLower}|${r.csLower}`);
      return c && Math.abs(c.area - r.area) < 1e-6 && c.bridges.length === r.n;
    });
  }

  const api = { compute, matchesPipeline, bins, CS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConditionProfile = api;
})(typeof window !== "undefined" ? window : globalThis);
