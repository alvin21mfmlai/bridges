/* "Every bridge" view of the step 1 map: one dot per bridge with element data, coloured by the
   latest year it appears in the element data.

   The state shapes in usmap.js were drawn with the Albers USA projection (scale 1300, centre of the
   map at 487.5, 305), so the bridges are projected the same way here and land on the right spot.
   That projection has no room for Puerto Rico and Guam, so those two get small insets.

   BridgeDots.load(data, outlines) turns data/all-bridges.json into map positions (once).
   BridgeDots.draw(pts, pxWidth, dpr) paints them on a canvas the size of the map on screen. */
(function (root) {
  const RAD = Math.PI / 180, EPS = 1e-6;

  // Latest year with element data, in four groups. Recent data in blue, older data in warm colours.
  const GROUPS = [
    { label: "2025", lo: 2025, hi: 2025, color: "#1d5f99" },
    { label: "2022 to 2024", lo: 2022, hi: 2024, color: "#4fa8d8" },
    { label: "2019 to 2021", lo: 2019, hi: 2021, color: "#e8a93a" },
    { label: "2016 to 2018", lo: 2016, hi: 2018, color: "#d4612a" },
  ];
  const groupOf = (year) => { for (let k = 0; k < GROUPS.length; k++) if (year >= GROUPS[k].lo) return k; return GROUPS.length - 1; };

  // Conic equal-area projection, built the same way as the d3-geo library: rotate the longitude,
  // project, scale, then move so that `center` lands on `translate`. Points outside `extent` are
  // dropped, which is how Albers USA decides between the lower 48, Alaska and Hawaii.
  function conic({ rotate, center, parallels, scale, translate, extent }) {
    const sy0 = Math.sin(parallels[0] * RAD), n = (sy0 + Math.sin(parallels[1] * RAD)) / 2;
    const c = 1 + sy0 * (2 * n - sy0), r0 = Math.sqrt(c) / n;
    const raw = (l, p) => { const r = Math.sqrt(c - 2 * n * Math.sin(p)) / n; return [r * Math.sin(l * n), r0 - r * Math.cos(l * n)]; };
    const cc = raw(center[0] * RAD, center[1] * RAD);
    const dx = translate[0] - scale * cc[0], dy = translate[1] + scale * cc[1];
    return (lon, lat) => {
      let l = (lon + rotate) * RAD;
      if (l > Math.PI) l -= 2 * Math.PI; else if (l < -Math.PI) l += 2 * Math.PI;
      const q = raw(l, lat * RAD), x = dx + scale * q[0], y = dy - scale * q[1];
      return x >= extent[0][0] && x <= extent[1][0] && y >= extent[0][1] && y <= extent[1][1] ? [x, y] : null;
    };
  }
  const K = 1300, TX = 487.5, TY = 305;
  const lower48 = conic({ rotate: 96, center: [-0.6, 38.7], parallels: [29.5, 45.5], scale: K, translate: [TX, TY],
    extent: [[TX - 0.455 * K, TY - 0.238 * K], [TX + 0.455 * K, TY + 0.238 * K]] });
  const alaska = conic({ rotate: 154, center: [-2, 58.5], parallels: [55, 65], scale: K * 0.35, translate: [TX - 0.307 * K, TY + 0.201 * K],
    extent: [[TX - 0.425 * K + EPS, TY + 0.120 * K + EPS], [TX - 0.214 * K - EPS, TY + 0.234 * K - EPS]] });
  const hawaii = conic({ rotate: 157, center: [-3, 19.9], parallels: [8, 18], scale: K, translate: [TX - 0.205 * K, TY + 0.212 * K],
    extent: [[TX - 0.214 * K + EPS, TY + 0.166 * K + EPS], [TX - 0.115 * K - EPS, TY + 0.234 * K - EPS]] });
  const albersUsa = (lon, lat) => lower48(lon, lat) || alaska(lon, lat) || hawaii(lon, lat);

  // Insets for the two territories, in map units, in the empty sea to the right of Florida
  const INSETS = {
    PR: { name: "Puerto Rico", x: 866, y: 470, w: 100, h: 50 },
    GU: { name: "Guam", x: 914, y: 548, w: 52, h: 48 },
  };
  // a plain longitude-latitude projection that fits a territory's outline into its inset box
  function insetProjection(box, rings) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    rings.forEach((r) => r.forEach(([lon, lat]) => { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }));
    const kx = Math.cos(((y0 + y1) / 2) * RAD), pad = 5;
    const s = Math.min((box.w - 2 * pad) / ((x1 - x0) * kx), (box.h - 2 * pad) / (y1 - y0));
    const ox = box.x + box.w / 2 - (((x0 + x1) / 2) * kx) * s, oy = box.y + box.h / 2 + ((y0 + y1) / 2) * s;
    return (lon, lat) => [ox + lon * kx * s, oy - lat * s];
  }
  const ringsOf = (g) => (g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []);

  // data/all-bridges.json + the state outlines (geo/states.json) -> map positions and colour groups
  function load(data, outlines) {
    const n = data.lon.length, X = new Float32Array(n), Y = new Float32Array(n), G = new Uint8Array(n), S = new Uint8Array(n);
    const insetProj = {}, insetPaths = {};
    for (const f of outlines.features) {
      const st = f.properties.st; if (!INSETS[st]) continue;
      const rings = ringsOf(f.geometry), pr = insetProj[st] = insetProjection(INSETS[st], rings);
      insetPaths[st] = rings.map((r) => "M" + r.map(([lon, lat]) => pr(lon, lat).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("");
    }
    const perState = {}, perGroup = new Array(GROUPS.length).fill(0);
    let lon = 0, lat = 0, i = 0, kept = 0, off = 0;
    data.states.forEach((st, si) => {
      const tally = perState[st] = { shown: 0, groups: new Array(GROUPS.length).fill(0) };
      for (let j = 0; j < data.count[si]; j++, i++) {
        lon += data.lon[i]; lat += data.lat[i];
        const lo = lon / 100, la = lat / 100, p = insetProj[st] ? insetProj[st](lo, la) : albersUsa(lo, la);
        if (!p) { off++; continue; }
        const g = groupOf(data.first + data.last[i]);
        X[kept] = p[0]; Y[kept] = p[1]; G[kept] = g; S[kept] = si; kept++;
        tally.shown++; tally.groups[g]++; perGroup[g]++;
      }
    });
    return { n: kept, x: X.subarray(0, kept), y: Y.subarray(0, kept), g: G.subarray(0, kept), s: S.subarray(0, kept),
      states: data.states, perState, perGroup, offMap: off, insetPaths };
  }

  // Paint the dots on a canvas as wide as the map is on screen (pxWidth CSS pixels). The dot size
  // follows the map width, so the dots stay distinct on a phone. Pixels are blended directly, in
  // the file's order (by state, then west to east), so no colour group is drawn on top of another.
  function draw(pts, pxWidth, dpr, viewW = 975, viewH = 610) {
    const cv = document.createElement("canvas"), k = (pxWidth / viewW) * dpr;
    const W = (cv.width = Math.round(viewW * k)), H = (cv.height = Math.round(viewH * k));
    const g = cv.getContext("2d"), img = g.createImageData(W, H), px = img.data;
    const want = Math.min(1.2, Math.max(0.55, pxWidth / 1000)) * dpr, size = Math.max(1, Math.round(want));
    // a dot drawn bigger than wanted is made fainter, so the map looks equally dense at any size
    const alpha = Math.min(1, (pxWidth < 600 ? 0.4 : 0.42) * (want * want) / (size * size));
    const rgb = GROUPS.map((c) => [1, 3, 5].map((i) => parseInt(c.color.slice(i, i + 2), 16)));
    for (let i = 0; i < pts.n; i++) {
      const c = rgb[pts.g[i]], x0 = Math.round(pts.x[i] * k - size / 2), y0 = Math.round(pts.y[i] * k - size / 2);
      for (let y = Math.max(0, y0); y < Math.min(H, y0 + size); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x0 + size); x++) {
          const o = (y * W + x) * 4, da = px[o + 3] / 255, oa = alpha + da * (1 - alpha);
          px[o] = (c[0] * alpha + px[o] * da * (1 - alpha)) / oa;
          px[o + 1] = (c[1] * alpha + px[o + 1] * da * (1 - alpha)) / oa;
          px[o + 2] = (c[2] * alpha + px[o + 2] * da * (1 - alpha)) / oa;
          px[o + 3] = oa * 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  root.BridgeDots = { load, draw, albersUsa, GROUPS, INSETS };
})(typeof window !== "undefined" ? window : globalThis);
