// Builds public/catalog.js from the folder tree under public/data.
//
//   public/data/<STATE>/<element-type-folder>/<element-id>/observations.csv  (required: inspection history)
//                                                          model.csv         (optional: pipeline values for cross-checking)
//                                                          ...any other files (offered as downloads)
//
// The site fits and draws every curve in the browser from observations.csv.
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

      const m = readCSV(join(dir, "model.csv"))[0] || {};
      const obsRows = readCSV(join(dir, "observations.csv"));
      if (!typeName && m.element_name) typeName = m.element_name;
      if (!typeName) { const sc = (obsRows[0]?.scope || "").match(/'([^']+)'/); if (sc) typeName = sc[1]; }
      if (!png && !obsRows.length) { console.warn(`skip ${state}/${typeDir}/${id}: no observations.csv or image`); continue; }

      // Raw inspection records; the browser builds intervals, fits the rate and draws the curves.
      const truthy = (v) => /^(true|1|yes)$/i.test(String(v).trim());
      const obs = obsRows
        .filter((r) => r.date)
        .map((r) => {
          const cs = ["cs1", "cs2", "cs3", "cs4"].map((k) => num(r[k]));
          const total = num(r.total);
          let b = num(r.b);
          if (b == null && total && cs[2] != null && cs[3] != null) b = (cs[2] + cs[3]) / total;
          return {
            d: r.date.slice(0, 10), b, total, cs,
            used: r.used_in_fit === undefined ? b != null : truthy(r.used_in_fit),
            latest: truthy(r.is_latest),
            insp: r.inspection_id || null, report: r.report_type_id || null,
            maint: r.maintenance_completion_date || null,
          };
        })
        .sort((x, y) => x.d.localeCompare(y.d));

      const base = `data/${state}/${typeDir}/${id}/`;
      elements.push({
        id,
        bridgeId: obsRows[0]?.bridge_id || null,
        image: png ? base + png : null,
        files: files.map((f) => ({ name: f, href: base + f })),
        obs,
        // values reported by the modelling pipeline, used only to cross-check the in-browser fit
        pipeline: {
          status: m.status || null,
          ratePerYear: num(m.rate_per_year),
          rmsePP: num(m.rmse_pp),
          persistenceRmsePP: num(m.persistence_rmse_pp),
          forecastYears: num(m.forecast_years),
          nBridges: num(m.n_bridges),
          nIntervals: num(m.n_intervals),
          atUpperBound: m.at_upper_bound ? truthy(m.at_upper_bound) : null,
        },
      });
      count++;
    }
    if (elements.length) types[typeDir] = { name: typeName || titleCase(typeDir), elements };
  }
  if (Object.keys(types).length) catalog.states[code] = { folder: state, types };
}

writeFileSync(outFile, `/* generated by scripts/build-catalog.mjs — do not edit */\nwindow.BRIDGE_CATALOG = ${JSON.stringify(catalog, null, 1)};\n`);
console.log(`catalog.js: ${Object.keys(catalog.states).length} state(s), ${count} element(s)`);
