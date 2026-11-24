/* Bridge locations map (top of step 4), on a GIS basemap (Leaflet). It has two levels, matching
   step 3:
     element type level  one dot per bridge that has the selected element in the period, coloured
                         by condition, bridge age or one colour (Location)
     bridge level        one dot per bridge with a health score in the period (opts.bridgeScores),
                         coloured by health score, bridge age or one colour (Location)

   Data, both from scripts/prepare_nbi.py run with the NBI inventory folder:
     data/<ST>/bridges.json(.gz)   every bridge's position (id, lat, lon ×1e5, year masks)
     data/<ST>/loc/<EN>.json(.gz)  the bridges with that element and their record per data year
   A bridge is shown at its latest record inside the period, and left out for the same reasons
   as in the charts, so the count matches the figures above the charts.
   At element type level the hover box also shows the selected element's score (from its CS
   shares) and the bridge's health score over all its element types (data/<ST>/health.json,
   through opts.health) for its latest data year in the period, once the scores have loaded.
   At bridge level each dot is at the bridge's latest score year in the period, and the hover box
   shows that score.

   Settings (basemap key, credits, state border) are in mapconfig.js, which loads before this
   file. With a CARTO basemaps key the map uses the light grey Positron map; without one it uses
   OpenStreetMap's standard tiles, which are fine for testing but not for heavy use. */
(function (root) {
  const CFG = Object.assign({ cartoKey: "", credits: "full", stateOutline: true }, root.MAP_CONFIG || {});
  const CARTO_KEY = String(CFG.cartoKey || "").trim();

  const BASEMAPS = {
    carto: {
      url: `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
      opts: { maxNativeZoom: 18, maxZoom: 20,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attribution/">CARTO</a>' },
    },
    osm: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      opts: { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
    },
  };
  const AGE_MIN = 1, AGE_MAX = 100;
  const OTHER = "#8a52c9"; // other bridges (purple)
  const EXCL = ["", "no_quantity", "quantity_check", "no_deck_area", "no_age"];
  // colours: condition uses the site's CS colours; age uses five 20-year groups (light to dark)
  const COND = [{ c: "#2e8540", label: "None" }, { c: "#c99a06", label: "Above 0% to 5%" }, { c: "#c4302b", label: "Above 5%" }];
  // the last two groups only occur at bridge level, which keeps every bridge with a score
  const AGEC = [{ c: "#c6dbef", label: "1–20 years" }, { c: "#85b7eb", label: "21–40 years" }, { c: "#378add", label: "41–60 years" },
    { c: "#185fa5", label: "61–80 years" }, { c: "#0c2f5c", label: "81–100 years" },
    { c: "#4a5560", label: "Over 100 years", extra: true }, { c: "#c3c9ce", label: "Year built unknown", extra: true }];
  const ONE = "#0071b8";
  const CS_COLORS = ["#2e8540", "#c99a06", "#e0702a", "#c4302b"]; // CS1 to CS4, as in the charts
  // bridge health score bands, in the CS1 to CS4 colours (most bridges score high, so the bands are finer at the top)
  const BHI = [{ c: CS_COLORS[0], label: "95% or more" }, { c: CS_COLORS[1], label: "85% to below 95%" },
    { c: CS_COLORS[2], label: "70% to below 85%" }, { c: CS_COLORS[3], label: "Below 70%" }];
  // the element's quantity is labelled by its unit: a length, an area or a count
  const QTY_LABEL = { "ft": "Length", "sq ft": "Area", "each": "Count" };

  function decodeLoc(d) {
    // rows are delta-encoded; runs are listed bridge by bridge in columns
    const rows = new Int32Array(d.row.length);
    let acc = 0;
    for (let i = 0; i < d.row.length; i++) { acc += d.row[i]; rows[i] = acc; }
    const start = new Int32Array(d.nrun.length + 1);
    for (let i = 0; i < d.nrun.length; i++) start[i + 1] = start[i] + d.nrun[i];
    return { base: d.base, rows, start, yy: d.yy, yb: d.yb, q: d.q, s1: d.s1, s2: d.s2, s3: d.s3, ex: d.ex };
  }

  // Bridges with the element in period [s, e]: latest record up to e, kept if its year is >= s.
  function pick(L, B, s, e) {
    const out = [], excluded = {};
    let noPos = 0;
    const eo = e - L.base, so = s - L.base;
    for (let i = 0; i < L.rows.length; i++) {
      let best = -1, bestY = -1;
      for (let j = L.start[i]; j < L.start[i + 1]; j++) {
        const y0 = Math.floor(L.yy[j] / 100), y1 = L.yy[j] % 100;
        if (y0 > eo) continue;
        const y = Math.min(y1, eo);
        if (y > bestY) { bestY = y; best = j; }
      }
      if (best < 0 || bestY < so) continue;
      const year = L.base + bestY, ex = L.ex[best];
      if (ex) { excluded[EXCL[ex]] = (excluded[EXCL[ex]] || 0) + 1; continue; }
      const age = year - L.yb[best];
      if (age < AGE_MIN || age > AGE_MAX) { excluded.age_out_of_range = (excluded.age_out_of_range || 0) + 1; continue; }
      const r = L.rows[i], lat = B.lat[r], lon = B.lon[r];
      if (lat == null || lon == null) { noPos++; continue; }
      const s1 = L.s1[best], s2 = L.s2[best], s3 = L.s3[best];
      out.push({ row: r, lat: lat / 1e5, lon: lon / 1e5, year, age, yb: L.yb[best], q: L.q[best], s: [s1, s2, s3, Math.max(0, 1000 - s1 - s2 - s3)] });
    }
    return { pts: out, excluded, noPos };
  }

  // bridge level: each bridge with a score, at its latest score year ({ row, v, y, n, yb } from opts.bridgeScores)
  function pickBridges(P, B) {
    const out = [];
    let noPos = 0;
    for (const q of P) {
      const lat = B.lat[q.row], lon = B.lon[q.row];
      if (lat == null || lon == null) { noPos++; continue; }
      out.push({ row: q.row, lat: lat / 1e5, lon: lon / 1e5, year: q.y, yb: q.yb || null, age: q.yb ? q.y - q.yb : null, v: q.v, n: q.n });
    }
    return { pts: out, excluded: {}, noPos };
  }

  const condClass = (p) => { const poor = p.s[2] + p.s[3]; return poor === 0 ? 0 : poor <= 50 ? 1 : 2; };
  const bhiClass = (p) => (p.v >= 95 ? 0 : p.v >= 85 ? 1 : p.v >= 70 ? 2 : 3);
  const ageClass = (p) => (p.age == null || p.age < 0 ? 6 : p.age > AGE_MAX ? 5 : Math.min(4, Math.max(0, Math.floor((p.age - 1) / 20))));
  const ageBand = (age) => Math.floor((age - AGE_MIN) / 5);

  function create(opts) {
    const { el, load, fmt } = opts;
    const $ = (q) => el.querySelector(q);
    let map = null, base = null, outlineLayer = null, outlineRenderer = null, dotLayer = null, otherLayer = null, renderer = null, otherRenderer = null;
    let tileErrors = 0, tileLoads = 0, states = null, othersN = 0, pinRing = null;
    let cur = { st: null, en: null, level: null, s: 0, e: 0 }, B = null, L = null, picked = null, token = 0;
    let health = null; // { st, fn(row, s, e) → { v, y } | null } once opts.health has loaded the state's scores
    // colour choice kept per level: element type level starts on Condition, bridge level on BHI
    const ui = { colour: "cond", colourBy: { element: "cond", bridge: "bhi" }, others: false, age: "all", hide: new Set() };
    const isBridge = () => cur.level === "bridge";
    const keyOf = (c) => `${c.st}/${c.level === "bridge" ? "bridge" : c.en}/${c.s}-${c.e}`;

    function ensureMap() {
      if (map) return;
      map = root.L.map($(".bm-map"), { zoomSnap: 0.25, scrollWheelZoom: false, worldCopyJump: true, preferCanvas: true,
        attributionControl: CFG.credits !== "none" });
      const bm = CARTO_KEY ? BASEMAPS.carto : BASEMAPS.osm;
      if (map.attributionControl) {
        map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
        if (CFG.credits === "compact") compactCredits(map.attributionControl.getContainer());
      }
      base = root.L.tileLayer(bm.url, bm.opts).addTo(map);
      base.on("tileerror", () => { tileErrors++; noteTiles(); });
      base.on("tileload", () => { tileLoads++; noteTiles(); });
      // the grey "other bridges" sit in their own pane below the dots and ignore the mouse,
      // so hovering always reaches the coloured dots
      const pane = map.createPane("bmOthers");
      pane.style.zIndex = 350; pane.style.pointerEvents = "none";
      // the state border likewise, so it never covers the dots whenever it is drawn
      const opane = map.createPane("bmOutline");
      opane.style.zIndex = 340; opane.style.pointerEvents = "none";
      outlineRenderer = root.L.canvas({ padding: 0.3, pane: "bmOutline" });
      renderer = root.L.canvas({ padding: 0.3, tolerance: 4 });
      map.on("zoomend", () => { if (dotLayer) { const r = dotR(), w = dotW(); dotLayer.eachLayer((m) => m.setStyle({ radius: r, weight: w })); } });
      otherRenderer = root.L.canvas({ padding: 0.3, pane: "bmOthers" });
      // reset view button
      const Reset = root.L.Control.extend({
        options: { position: "topleft" },
        onAdd() {
          const box = root.L.DomUtil.create("div", "leaflet-bar leaflet-control");
          const b = root.L.DomUtil.create("a", "bm-reset", box);
          b.href = "#"; b.title = "Show the whole state"; b.setAttribute("role", "button"); b.setAttribute("aria-label", "Show the whole state");
          b.innerHTML = "&#8634;";
          root.L.DomEvent.on(b, "click", (ev) => { root.L.DomEvent.preventDefault(ev); fitState(); });
          root.L.DomEvent.disableClickPropagation(box);
          return box;
        },
      });
      new Reset().addTo(map);
      map.on("popupclose", clearPin);
      // wheel zoom only after the map is clicked, so the page still scrolls normally
      map.on("click focus", () => map.scrollWheelZoom.enable());
      map.getContainer().addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
    }
    // credits folded into a small (i) button; a click opens or closes them, links still work
    function compactCredits(box) {
      $(".bm-map").classList.add("bm-compact");
      box.setAttribute("role", "button"); box.setAttribute("tabindex", "0");
      box.setAttribute("aria-label", "Map credits"); box.title = "Map credits";
      const toggle = (ev) => {
        if (ev.target.closest("a")) return;
        box.classList.toggle("bm-open");
        box.setAttribute("aria-expanded", box.classList.contains("bm-open"));
      };
      box.setAttribute("aria-expanded", "false");
      box.addEventListener("click", toggle);
      box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(ev); } });
      root.L.DomEvent.disableClickPropagation(box);
    }
    const tilesFailed = () => tileErrors > 3 && tileLoads === 0;
    function noteTiles() {
      const n = $(".bm-tilenote");
      n.hidden = !tilesFailed();
      // without a basemap the state border is the only reference, so draw it then
      if (tilesFailed() && outlineLayer && !map.hasLayer(outlineLayer)) outlineLayer.addTo(map);
    }
    async function loadOutline(st) {
      try {
        if (!states) states = await load("geo/states.json");
        const f = states.features.find((x) => x.properties.st === st);
        if (outlineLayer) outlineLayer.remove();
        // the border is always loaded, as it sets the view of the whole state; drawn only if asked
        outlineLayer = f ? root.L.geoJSON(f, { interactive: false, renderer: outlineRenderer, pane: "bmOutline", style: { color: "#5b6670", weight: 1.2, fill: false } }) : null;
        if (outlineLayer && (CFG.stateOutline || tilesFailed())) outlineLayer.addTo(map);
      } catch (e) { outlineLayer = null; }
    }
    function fitState() {
      if (!map) return;
      const pts = picked && picked.pts.length ? picked.pts : null;
      if (outlineLayer) map.fitBounds(outlineLayer.getBounds(), { padding: [12, 12] });
      else if (pts) map.fitBounds(root.L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [20, 20] });
    }

    function colourOf(p) {
      if (ui.colour === "cond") return COND[condClass(p)].c;
      if (ui.colour === "bhi") return BHI[bhiClass(p)].c;
      if (ui.colour === "age") return AGEC[ageClass(p)].c;
      return ONE;
    }
    // dot size follows the zoom: small dots without an outline at state zoom, so crowded areas show
    // their real mix of colours, growing as the map zooms in
    const dotR = () => { const z = map ? map.getZoom() : 6; return z < 6 ? 1.6 : z < 7 ? 2 : z < 8 ? 2.6 : z < 9 ? 3.1 : 3.6; };
    const dotW = () => (map && map.getZoom() >= 8 ? 0.6 : 0);
    // class of a dot for the current colour, and the legend groups switched off by a click
    const classOf = () => (ui.colour === "cond" ? condClass : ui.colour === "bhi" ? bhiClass : ui.colour === "age" ? ageClass : () => 0);
    function shown() {
      if (!picked) return [];
      return ui.age === "all" || isBridge() ? picked.pts : picked.pts.filter((p) => ageBand(p.age) === +ui.age);
    }
    const scoreRow = (k, v, note) => `<span class="k">${k}:</span><span class="v">${v.toFixed(1)}%</span><span class="n">${note}</span>`;
    const posOf = (r) => `${(B.lat[r] / 1e5).toFixed(4)}, ${(B.lon[r] / 1e5).toFixed(4)}`; // 4 decimals: about 10 m
    // hover box at bridge level: the bridge's facts, then its health score with a bar in its band colour
    function tipBridge(p) {
      const row = (k, v) => `<span class="k">${k}:</span><span>${v}</span>`;
      return `<b>Structure ${fmt.esc(B.id[p.row])}</b>` +
        `<div class="bm-kv">${row("Built year", p.yb || "Unknown")}${p.age != null ? row("Age", `${p.age} years (${p.year} data)`) : ""}${row("Lat, Long", posOf(p.row))}</div>` +
        `<div class="bm-kv bm-score">${scoreRow("Bridge health score", p.v, `Average of ${p.n} element type${p.n === 1 ? "" : "s"} on this bridge, ${p.year} data`)}</div>` +
        `<span class="bm-bar bm-sbar"><i style="width:${p.v.toFixed(1)}%;background:${BHI[bhiClass(p)].c}"></i></span>`;
    }
    // hover box (and pinned popup) for one bridge: its facts, then the condition bar and CS shares
    function tipHtml(p) {
      if (isBridge()) return tipBridge(p);
      const id = B.id[p.row];
      const pc = (v) => `${(v / 10).toFixed(v % 10 ? 1 : 0)}%`;
      const w = p.s.map((v) => (v / 10).toFixed(2));
      const unit = cur.unit ? ` ${fmt.esc(cur.unit)}` : "";
      const qLabel = QTY_LABEL[cur.unit] || "Quantity";
      const pos = posOf(p.row);
      const row = (k, v) => `<span class="k">${k}:</span><span>${v}</span>`;
      const score = scoreRow;
      // element score: the selected element only, from the CS shares listed below (shares are in 0.1%)
      const es = (p.s[0] + 0.67 * p.s[1] + 0.33 * p.s[2]) / 10;
      // bridge health score: the average over every element type on the bridge, in its latest data year of the period
      const hv = health && health.st === cur.st ? health.fn(p.row, cur.s, cur.e) : null;
      return `<b>Structure ${fmt.esc(id)}</b>` +
        `<div class="bm-kv">${row("Built year", p.yb)}${row("Age", `${p.age} years (${p.year} record)`)}${row(qLabel, `${cur.unit === "each" ? fmt.int(Math.round(p.q)) : fmt.sig3(p.q)}${unit}`)}${row("Lat, Long", pos)}</div>` +
        `<div class="bm-kv bm-score">${hv ? `${score("Bridge health score", hv.v, `Average of ${hv.n} element type${hv.n === 1 ? "" : "s"} on this bridge, ${hv.y} data`)}` : ""}${score("Element score", es, "This element type only, from the CS shares below")}</div>` +
        `<span class="bm-bar">${p.s.map((v, k) => `<i style="width:${w[k]}%;background:${CS_COLORS[k]}"></i>`).join("")}</span>` +
        `<div class="bm-kv bm-cs">${p.s.map((v, k) => row(`<i style="background:${CS_COLORS[k]}"></i>CS${k + 1}`, pc(v))).join("")}</div>`;
    }
    function drawDots() {
      if (!map || !picked) return;
      if (dotLayer) dotLayer.remove();
      const all = shown(), cf = classOf();
      const pts = ui.hide.size ? all.filter((p) => !ui.hide.has(cf(p))) : all.slice();
      // draw order: worse condition (or older bridges) last so they stay on top. BHI uses a fixed
      // shuffle (by row) instead, so in crowded areas each band shows in proportion to its share.
      // Click "Below 70%" in the legend to see only the lowest scores.
      if (ui.colour === "cond") pts.sort((a, b) => condClass(a) - condClass(b));
      else if (ui.colour === "bhi") { const mix = (r) => Math.imul(r + 1, 2654435761) >>> 0; pts.sort((a, b) => mix(a.row) - mix(b.row)); }
      else if (ui.colour === "age") pts.sort((a, b) => (a.age ?? -1) - (b.age ?? -1));
      const r = dotR(), w = dotW();
      dotLayer = root.L.layerGroup(pts.map((p) => {
        const m = root.L.circleMarker([p.lat, p.lon], { renderer, radius: r, weight: w, color: "#ffffff", opacity: 0.9, fillColor: colourOf(p), fillOpacity: 0.92 });
        m.bindTooltip(() => tipHtml(p), { direction: "top", offset: [0, -4], className: "bm-tip", sticky: false });
        m.on("click", () => { m.closeTooltip(); pinPoint(p, false); findOut(""); });
        return m;
      })).addTo(map);
      drawLegend(all);
    }
    // other bridges, in purple: the state's bridges with element data in the period that are not
    // shown as coloured dots (no such element, left out of the charts, or outside the age band)
    function drawOthers() {
      if (otherLayer) { otherLayer.remove(); otherLayer = null; }
      othersN = 0;
      if (!ui.others || isBridge() || !map || !B || !picked) return;
      const have = new Set(shown().map((p) => p.row));
      const y0 = B.years[0], mask = Array.from({ length: cur.e - cur.s + 1 }, (_, i) => 1 << (cur.s + i - y0)).reduce((a, b) => a | b, 0);
      const ms = [];
      for (let r = 0; r < B.id.length; r++) {
        if (have.has(r) || B.lat[r] == null || !(B.el[r] & mask)) continue;
        ms.push(root.L.circleMarker([B.lat[r] / 1e5, B.lon[r] / 1e5], { renderer: otherRenderer, radius: 1.5, stroke: false, fillColor: OTHER, fillOpacity: 0.32, interactive: false }));
      }
      othersN = ms.length;
      otherLayer = root.L.layerGroup(ms).addTo(map);
      if (dotLayer) dotLayer.eachLayer((m) => m.bringToFront());
    }
    // ---- pinned bridge: a popup that stays open, with a ring round the dot ----
    function clearPin() { if (pinRing) { pinRing.remove(); pinRing = null; } }
    function pinAt(ll, html) {
      clearPin();
      map.openPopup(root.L.popup({ className: "bm-pop", offset: [0, -6], maxWidth: 300, autoPanPadding: [24, 24] }).setLatLng(ll).setContent(html));
      pinRing = root.L.circleMarker(ll, { renderer, radius: 9, weight: 2.5, color: "#1b2733", fill: false, interactive: false }).addTo(map);
    }
    function pinPoint(p, zoom) {
      if (!map) return;
      if (zoom) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13), { animate: false });
      pinAt([p.lat, p.lon], tipHtml(p));
    }
    // ---- find a bridge by structure number ----
    const norm = (s) => String(s || "").toUpperCase().replace(/\s+/g, "");
    function findOut(html) { $(".bm-find-out").innerHTML = html; }
    function showPoint(p) {
      // a bridge outside the selected age band: show all ages so its dot is on the map
      if (!isBridge() && ui.age !== "all" && ageBand(p.age) !== +ui.age) { setAge("all"); if (opts.onAge) opts.onAge("all"); }
      // its legend group switched off: switch it back on
      const k = classOf()(p);
      if (ui.hide.has(k)) { ui.hide.delete(k); drawDots(); }
      pinPoint(p, true);
      findOut("");
    }
    function find(qRaw) {
      if (!picked || !B) return;
      const q = norm(qRaw), q0 = q.replace(/^0+/, "");
      if (!q) { findOut(""); return; }
      const same = (id) => id === q || id === q0 || id.replace(/^0+/, "") === q0;
      const p = picked.pts.find((x) => same(B.id[x.row]));
      if (p) { showPoint(p); return; }
      const r = B.id.findIndex((id) => same(id));
      if (r >= 0) {
        const id = fmt.esc(B.id[r]);
        if (B.lat[r] == null) { findOut(`Structure ${id} has no recorded position.`); return; }
        const ll = [B.lat[r] / 1e5, B.lon[r] / 1e5];
        map.setView(ll, Math.max(map.getZoom(), 13), { animate: false });
        pinAt(ll, `<b>Structure ${id}</b><br>Not one of the bridges shown: ${isBridge() ? "it has no health score" : `it has no usable record of ${fmt.esc(cur.name || "this element")}`} in ${cur.s}–${cur.e}.`);
        findOut(`Structure ${id} is not one of the bridges shown (see the map).`);
        return;
      }
      map.closePopup();
      // no exact match: suggest bridges shown whose number contains the text, those starting with it first
      const hits = picked.pts.filter((x) => B.id[x.row].includes(q0 || q))
        .sort((a, b) => (B.id[b.row].startsWith(q0 || q) - B.id[a.row].startsWith(q0 || q)) || B.id[a.row].localeCompare(B.id[b.row]));
      if (!hits.length) { findOut(`No bridge numbered ${fmt.esc(qRaw)} in ${fmt.esc(cur.stateName || "this state")}.`); return; }
      findOut(`No exact match. Did you mean:<div class="bm-sugg">${hits.slice(0, 6).map((x) => `<button type="button" data-row="${x.row}">${fmt.esc(B.id[x.row])}</button>`).join("")}</div>` +
        (hits.length > 6 ? `<span>and ${fmt.int(hits.length - 6)} more. Type more of the number to narrow it down.</span>` : ""));
    }

    function drawLegend(pts) {
      const one = [{ c: ONE, label: isBridge() ? "Bridges with a health score" : "Bridges with this element" }];
      const cls = ui.colour === "cond" ? COND : ui.colour === "bhi" ? BHI : ui.colour === "age" ? AGEC : one;
      const cf = classOf(), counts = cls.map(() => 0);
      pts.forEach((p) => { counts[cf(p)]++; });
      const tot = pts.length || 1, pc = (n) => (n && n / tot < 0.005 ? "<1%" : `${Math.round((100 * n) / tot)}%`);
      const many = cls.length > 1;
      $(".bm-leg-title").textContent = ui.colour === "cond" ? "Share of the element in CS3 or CS4" : ui.colour === "bhi" ? "Bridge Health Index (BHI)" : ui.colour === "age" ? "Bridge age" : "Bridges";
      // the extra age groups (over 100 years, year built unknown) are listed only when some bridges are in them
      // each group is a button: click to hide or show its dots. Counts and shares cover every group.
      $(".bm-leg-rows").innerHTML = cls.map((c, i) => (c.extra && !counts[i] ? "" : many
        ? `<button type="button" class="bm-row bm-row-btn" data-k="${i}" aria-pressed="${!ui.hide.has(i)}"><span class="bm-dot" style="background:${c.c}"></span>${c.label}<span class="bm-n">${fmt.int(counts[i])}<small>${pc(counts[i])}</small></span></button>`
        : `<div class="bm-row"><span class="bm-dot" style="background:${c.c}"></span>${c.label}<span class="bm-n">${fmt.int(counts[i])}</span></div>`)).join("") +
        (many ? `<p class="bm-leg-hint">Click or tap a group to hide or show it.</p>` : "") +
        (ui.others ? `<div class="bm-row bm-row-other"><span class="bm-dot" style="background:${OTHER}"></span>Other bridges<span class="bm-n">${fmt.int(othersN)}</span></div>` : "");
    }
    function drawSummary() {
      const n = picked.pts.length + picked.noPos, sh = shown().length;
      const ageTxt = ui.age === "all" ? "" : `, ${fmt.int(sh)} of them aged ${opts.ageLabel(+ui.age)} years`;
      const pos = picked.noPos ? ` ${fmt.int(picked.noPos)} ${picked.noPos === 1 ? "has" : "have"} no recorded position.` : "";
      if (isBridge()) { $(".bm-sub").textContent = `${fmt.int(n)} bridge${n === 1 ? "" : "s"} in ${cur.stateName} with a health score, ${cur.s} to ${cur.e}.${pos}`; return; }
      $(".bm-sub").textContent = `${fmt.int(n)} bridge${n === 1 ? "" : "s"} in ${cur.stateName} with ${cur.name} (element ${cur.en}), ${cur.s} to ${cur.e}${ageTxt}.${pos}`;
    }
    function fillAgeSelect() {
      const counts = new Map();
      picked.pts.forEach((p) => { const u = ageBand(p.age); counts.set(u, (counts.get(u) || 0) + 1); });
      if (ui.age !== "all" && !counts.has(+ui.age)) ui.age = "all";
      const sel = $(".bm-age");
      sel.innerHTML = `<option value="all">All ages</option>` + [...counts.keys()].sort((a, b) => a - b)
        .map((u) => `<option value="${u}">${opts.ageLabel(u)} years (${fmt.int(counts.get(u))})</option>`).join("");
      sel.value = ui.age;
    }

    // colour buttons of this level: Condition at element type level, BHI at bridge level
    function setLevelButtons() {
      const lv = isBridge() ? "bridge" : "element";
      if (ui.colour !== ui.colourBy[lv]) ui.hide.clear();
      ui.colour = ui.colourBy[lv];
      el.classList.toggle("bm-bridge", lv === "bridge");
      el.querySelectorAll(".bm-seg button").forEach((b) => {
        b.hidden = (b.dataset.colour === "cond" && lv === "bridge") || (b.dataset.colour === "bhi" && lv === "element");
        b.setAttribute("aria-pressed", String(b.dataset.colour === ui.colour));
      });
    }
    async function update(sel) {
      const my = ++token;
      Object.assign(cur, sel);
      cur.level = sel.level === "bridge" ? "bridge" : sel.en != null ? "element" : null;
      if (!cur.level) { el.hidden = true; return; }
      const key = keyOf(cur);
      if (key !== cur.key) ui.hide.clear(); // a new selection shows every legend group again
      el.hidden = false;
      setLevelButtons();
      if (el.classList.contains("bm-collapsed")) return; // loads when shown again
      $(".bm-sub").textContent = "Loading bridge positions…";
      if (map) { map.closePopup(); clearPin(); }
      findOut("");
      const lvl = cur.level;
      let Bn, Ln, Pn;
      try {
        if (lvl === "bridge") [Bn, Pn] = await Promise.all([load(`data/${sel.st}/bridges.json`), opts.bridgeScores(sel.st, sel.s, sel.e)]);
        else [Bn, Ln] = await Promise.all([load(`data/${sel.st}/bridges.json`), load(`data/${sel.st}/loc/${sel.en}.json`)]);
      } catch (e) {
        if (my !== token) return;
        $(".bm-sub").textContent = lvl === "bridge" ? "The health scores could not be loaded for this selection." : "Bridge positions are not available for this selection."; return;
      }
      if (my !== token) return;
      const newState = !B || B.state !== Bn.state;
      B = Bn;
      if (lvl === "bridge") picked = pickBridges(Pn, B);
      else { L = Ln.__dec || (Ln.__dec = decodeLoc(Ln)); picked = pick(L, B, sel.s, sel.e); ui.age = sel.age ?? ui.age; }
      ensureMap();
      map.invalidateSize();
      if (newState || !cur.key || cur.key.split("/")[0] !== sel.st) { await loadOutline(sel.st); fitState(); }
      cur.key = key;
      if (lvl === "element") fillAgeSelect();
      drawSummary(); drawOthers(); drawDots();
      if (opts.onCount) opts.onCount(picked);
      // health scores load after the dots are drawn, and show in the hover box once they arrive
      if (lvl === "element" && opts.health && (!health || health.st !== sel.st)) {
        const st = sel.st;
        opts.health(st).then((fn) => { if (cur.st === st) health = { st, fn }; }).catch(() => {});
      }
    }
    function setAge(v) {
      ui.age = v; if (!picked || isBridge()) return;
      const s = $(".bm-age"); if ([...s.options].some((o) => o.value === v)) s.value = v; else { ui.age = "all"; s.value = "all"; }
      drawSummary(); drawOthers(); drawDots();
    }

    // controls
    $(".bm-leg-rows").addEventListener("click", (ev) => {
      const b = ev.target.closest(".bm-row-btn"); if (!b) return;
      const k = +b.dataset.k, n = $(".bm-leg-rows").querySelectorAll(".bm-row-btn").length;
      if (ui.hide.has(k)) ui.hide.delete(k);
      else if (ui.hide.size < n - 1) ui.hide.add(k); // at least one group stays on
      drawDots();
    });
    el.querySelectorAll(".bm-seg button").forEach((b) => b.addEventListener("click", () => {
      if (ui.colour !== b.dataset.colour) ui.hide.clear();
      ui.colour = b.dataset.colour;
      ui.colourBy[isBridge() ? "bridge" : "element"] = ui.colour;
      el.querySelectorAll(".bm-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawDots();
    }));
    $(".bm-others").addEventListener("change", (ev) => { ui.others = ev.target.checked; drawOthers(); drawDots(); });
    $(".bm-age").addEventListener("change", (ev) => { setAge(ev.target.value); if (opts.onAge) opts.onAge(ui.age); });
    $(".bm-find").addEventListener("submit", (ev) => { ev.preventDefault(); find($(".bm-find-in").value); });
    $(".bm-find-out").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-row]"); if (!b || !picked) return;
      const p = picked.pts.find((x) => x.row === +b.dataset.row); if (p) { $(".bm-find-in").value = B.id[p.row]; showPoint(p); }
    });
    $(".bm-toggle").addEventListener("click", () => {
      const hide = !el.classList.contains("bm-collapsed");
      el.classList.toggle("bm-collapsed", hide);
      $(".bm-toggle").textContent = hide ? "Show map" : "Hide map";
      $(".bm-toggle").setAttribute("aria-expanded", String(!hide));
      try { localStorage.setItem("bridgeMapHidden", hide ? "1" : "0"); } catch (e) { /* storage unavailable */ }
      if (!hide) { if (cur.key !== keyOf(cur)) update({ ...cur }); else if (map) { map.invalidateSize(); } }
    });
    try {
      if (localStorage.getItem("bridgeMapHidden") === "1") {
        el.classList.add("bm-collapsed"); $(".bm-toggle").textContent = "Show map"; $(".bm-toggle").setAttribute("aria-expanded", "false");
      }
    } catch (e) { /* storage unavailable */ }

    return { update, setAge, get picked() { return picked; }, get map() { return map; } };
  }

  const api = { create, decodeLoc, pick, pickBridges, CARTO_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BridgeMap = api;
})(typeof window !== "undefined" ? window : globalThis);
