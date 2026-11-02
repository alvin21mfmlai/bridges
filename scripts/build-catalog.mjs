// Builds public/catalog.js from the folder tree under public/data.
//
//   public/data/<STATE>/<element-type-folder>/<element-id>/curve.png
//                                                          model.csv            (optional, recommended)
//                                                          forecast_origins.csv (optional)
//                                                          curve.csv            (optional)
//                                                          ...any other files   (offered as downloads)
//
// <STATE> is the two-letter USPS code (TX, CA, ...). The element-type display
// name comes from model.csv `element_name`; if absent, from the folder name.
// Zero dependencies. Run: node scripts/build-catalog.mjs
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "public", "data");
const outFile = join(root, "public", "catalog.js");

const dirs = (p) =>
  existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith(".") && statSync(join(p, n)).isDirectory()) : [];
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}
const readCSV = (p) => (existsSync(p) ? parseCSV(readFileSync(p, "utf8")) : []);
const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
const titleCase = (s) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const catalog = { generatedAt: new Date().toISOString(), states: {} };
let count = 0;

for (const state of dirs(dataDir).sort()) {
  const code = state.toUpperCase();
  const types = {};
  for (const typeDir of dirs(join(dataDir, state)).sort(natural)) {
    const elements = [];
    let typeName = null;
    for (const id of dirs(join(dataDir, state, typeDir)).sort(natural)) {
      const dir = join(dataDir, state, typeDir, id);
      const files = readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile()).sort();
      const png = files.find((f) => f.toLowerCase() === "curve.png") || files.find((f) => /\.(png|jpe?g|svg|webp)$/i.test(f));
      if (!png) { console.warn(`skip ${state}/${typeDir}/${id}: no curve image`); continue; }

      const m = readCSV(join(dir, "model.csv"))[0] || {};
      const o = readCSV(join(dir, "forecast_origins.csv"))[0] || {};
      const curve = readCSV(join(dir, "curve.csv"));
      if (!typeName && m.element_name) typeName = m.element_name;

      // forecast series sampled once a year for the card sparkline
      const series = curve
        .map((r) => [num(r.horizon_years), num(r.poor_severe_percent)])
        .filter(([h, v]) => h != null && v != null && Math.abs(h - Math.round(h)) < 1e-6)
        .map(([h, v]) => [Math.round(h), +v.toFixed(3)]);
      const last = curve[curve.length - 1];

      const base = `data/${state}/${typeDir}/${id}/`;
      elements.push({
        id,
        bridgeId: o.bridge_id || null,
        image: base + png,
        files: files.map((f) => ({ name: f, href: base + f })),
        model: {
          status: m.status || null,
          ratePerYear: num(m.rate_per_year),
          forecastYears: num(m.forecast_years),
          nBridges: num(m.n_bridges),
          nIntervals: num(m.n_intervals),
          rmsePP: num(m.rmse_pp),
          persistenceRmsePP: num(m.persistence_rmse_pp),
          observationsUsed: num(m.observations_used),
          observationsTotal: num(m.observations_total),
          worsening: num(m.worsening_intervals),
          unchanged: num(m.unchanged_intervals),
          improving: num(m.improving_intervals),
          scope: m.scope || null,
        },
        latest: {
          date: o.forecast_origin_date || null,
          pct: num(o.forecast_initial_share) == null ? null : num(o.forecast_initial_share) * 100,
          quantity: num(o.total_quantity),
        },
        forecast: last
          ? { date: (last.date || "").slice(0, 10), years: num(last.horizon_years), pct: num(last.poor_severe_percent), series }
          : null,
      });
      count++;
    }
    if (elements.length) types[typeDir] = { name: typeName || titleCase(typeDir), elements };
  }
  if (Object.keys(types).length) catalog.states[code] = { folder: state, types };
}

writeFileSync(outFile, `/* generated by scripts/build-catalog.mjs — do not edit */\nwindow.BRIDGE_CATALOG = ${JSON.stringify(catalog, null, 1)};\n`);
console.log(`catalog.js: ${Object.keys(catalog.states).length} state(s), ${count} element(s)`);
