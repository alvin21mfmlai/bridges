// Builds public/catalog.js from the folder tree under public/data.
//
//   public/data/<STATE>/<element-type-folder>/_profile/members.csv  (optional: condition-state profile of the type;
//                                                     model.csv, bins.csv, bridges.csv alongside)
//   public/data/<STATE>/<element-type-folder>/<element-id>/observations.csv  (required: inspection history)
//                                                          model.csv         (optional: pipeline values for cross-checking)
//                                                          ...any other files (offered as downloads)
//
// The site fits and draws every curve in the browser from observations.csv.
//
// <STATE> is the two-letter USPS code (TX, CA, ...). The element-type display
// name comes from model.csv `element_name`; if absent, from the folder name.
//
// Synthetic coverage: synthetic.config.json (repo root) can extend the catalog to every
// state and to extra element types by pointing them at an existing source folder. Each
// element's data is stored once in `catalog.sources` and referenced by `src`, so the
// copies cost almost nothing. A real folder always takes priority over a synthetic one.
//
// Zero dependencies. Run: node scripts/build-catalog.mjs
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "public", "data");
const outFile = join(root, "public", "catalog.js");

const dirs = (p) =>
  existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith(".") && !n.startsWith("_") && statSync(join(p, n)).isDirectory()) : [];
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

const ALL_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const catalog = { generatedAt: new Date().toISOString(), states: {}, sources: {}, profiles: {} };
const truthy = (v) => /^(true|1|yes)$/i.test(String(v).trim());

/* Condition-state profile of an element type (public/data/<STATE>/<type>/_profile/). The browser
   bins the bridges itself; bins.csv is kept only to cross-check the result. */
function readProfile(dir, key) {
  const m = readCSV(join(dir, "model.csv"))[0] || {};
  let members = readCSV(join(dir, "members.csv")).map((r) => ({
    bridge: r.bridge_id, element: r.element_id, date: (r.date || "").slice(0, 10), total: num(r.total),
    cs: ["cs1", "cs2", "cs3", "cs4"].map((k) => num(r[k])), yearBuilt: num(r.year_built), deckArea: num(r.deck_area_sq_ft),
    status: r.profile_status || "included",
  }));
  if (!members.length) // fall back to the per-bridge table
    members = readCSV(join(dir, "bridges.csv")).map((r) => ({
      bridge: r.bridge_id, element: r.element_ids, date: r.latest_condition_date, total: num(r.total_element_quantity),
      cs: [1, 2, 3, 4].map((k) => num(r[`cs${k}_quantity`])), yearBuilt: num(r.year_built), deckArea: num(r.deck_area_sq_ft), status: "included",
    }));
  if (!members.length) return null;
  const pipelineBins = existsSync(join(dir, "bins.csv"))
    ? readCSV(join(dir, "bins.csv")).filter((r) => num(r.total_deck_area_sq_ft) > 0).map((r) => ({
        cs: r.condition_state, ageLower: num(r.age_bin_lower), csLower: num(r.cs_percent_lower), area: num(r.total_deck_area_sq_ft), n: num(r.n_bridges),
      }))
    : null;
  const files = readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile()).sort();
  catalog.profiles[key] = {
    meta: {
      elementName: m.element_name || null, profileYear: num(m.profile_year) ?? new Date().getFullYear(), cutoffDate: m.cutoff_date || null,
      ageRange: m.age_range || "1-100 years", ageBinWidth: num(m.age_bin_width_years) || 5, csBinWidth: num(m.cs_bin_width_percent) || 5,
      areaBasis: m.area_basis || null, conditionBasis: m.condition_basis || null, status: m.status || null,
    },
    members, pipelineBins,
    files: files.map((f) => ({ name: f, href: `data/${key}/_profile/${f}` })),
  };
  return key;
}
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
      const src = `${code}/${typeDir}/${id}`;
      catalog.sources[src] = {
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
      };
      elements.push({ id, src });
      count++;
    }
    const profile = existsSync(join(dataDir, state, typeDir, "_profile")) ? readProfile(join(dataDir, state, typeDir, "_profile"), `${code}/${typeDir}`) : null;
    if (elements.length) types[typeDir] = { name: typeName || titleCase(typeDir), elements, ...(profile ? { profile } : {}) };
  }
  if (Object.keys(types).length) catalog.states[code] = { types };
}
const realCount = count;

/* ---------- synthetic coverage ---------- */
const cfgFile = join(root, "synthetic.config.json");
let synthetic = 0;
if (existsSync(cfgFile)) {
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  const srcType = catalog.states[cfg.source?.state?.toUpperCase()]?.types?.[cfg.source?.type];
  if (cfg.enabled && !srcType) console.warn(`synthetic: source ${cfg.source?.state}/${cfg.source?.type} not found, skipped`);
  if (cfg.enabled && srcType) {
    const states = cfg.states === "all" ? ALL_STATES : (cfg.states || []).map((c) => c.toUpperCase());
    for (const code of states) {
      const st = (catalog.states[code] ||= { types: {} });
      for (const t of cfg.types || []) {
        if (st.types[t.slug]) continue; // real data wins
        st.types[t.slug] = {
          name: t.name,
          synthetic: true,
          elements: srcType.elements.map((e) => ({ id: e.id, src: e.src })),
          ...(srcType.profile ? { profile: srcType.profile } : {}),
        };
        synthetic += srcType.elements.length;
      }
    }
    // keep the configured type order in every state, real types first if not configured
    const order = (cfg.types || []).map((t) => t.slug);
    for (const st of Object.values(catalog.states)) {
      const keys = Object.keys(st.types).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? -1 : ia) - (ib < 0 ? -1 : ib) || natural(a, b);
      });
      st.types = Object.fromEntries(keys.map((k) => [k, st.types[k]]));
    }
    catalog.states = Object.fromEntries(Object.keys(catalog.states).sort().map((k) => [k, catalog.states[k]]));
  }
}

writeFileSync(outFile, `/* generated by scripts/build-catalog.mjs — do not edit */\nwindow.BRIDGE_CATALOG = ${JSON.stringify(catalog)};\n`);
const nTypes = new Set(Object.values(catalog.states).flatMap((s) => Object.keys(s.types))).size;
console.log(`catalog.js: ${Object.keys(catalog.states).length} state(s), ${nTypes} element type(s), ${realCount} real + ${synthetic} synthetic element(s), ${Object.keys(catalog.sources).length} source dataset(s), ${Object.keys(catalog.profiles).length} profile(s)`);
