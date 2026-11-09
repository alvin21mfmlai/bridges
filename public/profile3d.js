/* Hand-built 3D bar chart (orthographic SVG) for the condition-state profile.
 * Floor axes: bridge age bin (u) and CS% bin (v); bar height and colour: the cell value
 * (deck area, or a normalised share of it).
 * Drag to rotate (all four figures stay in sync); hover a bar for its values.
 */
(function (root) {
  "use strict";
  const FONT = "Noto Sans, Open Sans, Segoe UI, Arial, sans-serif";
  const PLASMA = [[0, [13, 8, 135]], [0.25, [126, 3, 168]], [0.5, [204, 71, 120]], [0.75, [248, 149, 64]], [1, [240, 249, 33]]];
  function plasma(t) {
    t = Math.min(1, Math.max(0, t));
    for (let i = 1; i < PLASMA.length; i++) if (t <= PLASMA[i][0]) {
      const [t0, a] = PLASMA[i - 1], [t1, b] = PLASMA[i], f = (t - t0) / (t1 - t0);
      return a.map((x, k) => Math.round(x + (b[k] - x) * f));
    }
    return PLASMA[PLASMA.length - 1][1];
  }
  const rgb = (c, s = 1) => `rgb(${c.map((x) => Math.round(x * s)).join(",")})`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function niceStep(range, target) {
    const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function niceTop(v, target = 5) { const m = Math.max(v, 1), s = niceStep(m, target); return { top: Math.ceil((m * 1.04) / s) * s, step: s }; }

  const DEFAULT_VIEW = { az: 42, el: 26 };
  const view = { ...DEFAULT_VIEW };

  /* cfg: { cells:[{u,v,value}], bins, zTop, zStep, cMax, csName, zLabel, fmtValue, fmtTick, tipFor(cell) } */
  function render(box, cfg) {
    const W = Math.max(240, Math.round(box.clientWidth));
    const narrow = W < 480, fs = narrow ? 10 : 11;
    const H = Math.round(Math.min(520, Math.max(270, W * (narrow ? 0.92 : 0.78))));
    const zStep = narrow && cfg.zTop / cfg.zStep > 4 ? cfg.zStep * 2 : cfg.zStep;
    const NU = cfg.bins.age.length, NV = cfg.bins.cs.length, HS = 12;
    const az = (view.az * Math.PI) / 180, el = (view.el * Math.PI) / 180;
    const sa = Math.sin(az), ca = Math.cos(az), se = Math.sin(el), ce = Math.cos(el);
    const R = Math.hypot(NU, NV) / 2;
    const mL = narrow ? 60 : 58, mR = narrow ? 16 : 22, mT = 12, mB = narrow ? 54 : 64;
    const k = Math.min((W - mL - mR) / (2 * R), (H - mT - mB) / (HS * ce + 2 * R * se));
    const cx = mL + (W - mL - mR) / 2;
    const baseY = H - mB - (R * se - 0) * k; // screen y of the floor centre
    const P = (u, v, z) => {
      const x = u - NU / 2, y = v - NV / 2, h = (z / cfg.zTop) * HS;
      const X = x * ca + y * sa, D = -x * sa + y * ca;
      return [cx + X * k, baseY - (h * ce + D * se) * k, D];
    };
    const pts = (a) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const zT = cfg.zTop;

    // which sides are at the back (walls) and front (labels)
    const farU = sa > 0 ? 0 : NU;       // wall at u = farU
    const farV = ca > 0 ? NV : 0;       // wall at v = farV
    const nearU = NU - farU, nearV = NV - farV;
    let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
    const wall = "#f7f8fa", line = "#d9dde1", lineFaint = "#e9ecef", text = "#595959";

    // floor and walls
    g += `<polygon points="${pts([P(0, 0, 0), P(NU, 0, 0), P(NU, NV, 0), P(0, NV, 0)])}" fill="${wall}" stroke="${line}"/>`;
    g += `<polygon points="${pts([P(farU, 0, 0), P(farU, NV, 0), P(farU, NV, zT), P(farU, 0, zT)])}" fill="${wall}" stroke="${line}"/>`;
    g += `<polygon points="${pts([P(0, farV, 0), P(NU, farV, 0), P(NU, farV, zT), P(0, farV, zT)])}" fill="${wall}" stroke="${line}"/>`;
    const L = (a, b, c = lineFaint, w = 1) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${c}" stroke-width="${w}"/>`;
    for (let u = 1; u < NU; u++) { g += L(P(u, 0, 0), P(u, NV, 0)); g += L(P(u, farV, 0), P(u, farV, zT)); }
    for (let v = 1; v < NV; v++) { g += L(P(0, v, 0), P(NU, v, 0)); g += L(P(farU, v, 0), P(farU, v, zT)); }
    for (let z = zStep; z <= zT + 1e-9; z += zStep) {
      g += L(P(farU, 0, z), P(farU, NV, z), line); g += L(P(0, farV, z), P(NU, farV, z), line);
    }

    // z axis on the left-most back corner
    const corners = [[farU, nearV], [nearU, farV]];
    const [zu, zv] = corners.sort((a, b) => P(a[0], a[1], 0)[0] - P(b[0], b[1], 0)[0])[0];
    g += L(P(zu, zv, 0), P(zu, zv, zT), "#8f8f8f");
    for (let z = 0; z <= zT + 1e-9; z += zStep) {
      const p = P(zu, zv, z);
      g += L(p, [p[0] - 5, p[1]], "#8f8f8f") + `<text x="${(p[0] - 8).toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="end" font-size="${fs}" fill="${text}">${cfg.fmtTick(z)}</text>`;
    }
    const zBase = P(zu, zv, 0);
    const zm = P(zu, zv, zT * 0.5);
    g += `<text transform="translate(${(zm[0] - (narrow ? 40 : 48)).toFixed(1)} ${zm[1].toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="${fs + 0.5}" fill="${text}">${esc(cfg.zLabel)}</text>`;

    // floor axis labels along the front edges: every 4th bin boundary (0, 20, … 100)
    const edgeLabels = (axis) => {
      let s = "";
      const N = axis === "u" ? NU : NV, step = N >= 16 ? 4 : 2;
      const at = (t, off) => (axis === "u" ? P(t, nearV + (nearV ? off : -off), 0) : P(nearU + (nearU ? off : -off), t, 0));
      for (let t = 0; t <= N; t += step) {
        const val = axis === "u" ? cfg.bins.aMin - 1 + t * cfg.bins.aw : t * cfg.bins.cw;
        const p = at(t, 0), q = at(t, 0.5), r = at(t, 1.9);
        s += L(p, q, "#8f8f8f");
        if (Math.hypot(r[0] - zBase[0], r[1] - zBase[1]) < 34) continue; // keep the z-axis corner readable
        s += `<text x="${r[0].toFixed(1)}" y="${(r[1] + 4).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${text}">${val}</text>`;
      }
      const a = at(0, 4.4), b = at(N, 4.4), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const title = axis === "u" ? "Bridge age (years)" : `${cfg.csName} quantity (%)`;
      s += `<text transform="translate(${m[0].toFixed(1)} ${(m[1] + 4).toFixed(1)}) rotate(${ang.toFixed(1)})" text-anchor="middle" font-size="${fs + 0.5}" font-weight="600" fill="${text}">${esc(title)}</text>`;
      return s;
    };
    g += edgeLabels("u") + edgeLabels("v");

    // bars, far to near
    const inset = 0.16;
    const bars = cfg.cells.map((c) => {
      const u0 = c.u + inset, u1 = c.u + 1 - inset, v0 = c.v + inset, v1 = c.v + 1 - inset;
      return { c, u0, u1, v0, v1, depth: P(c.u + 0.5, c.v + 0.5, 0)[2] };
    }).sort((a, b) => b.depth - a.depth);
    let barsSvg = "", labels = "";
    for (const b of bars) {
      const z = b.c.value, col = plasma(b.c.value / cfg.cMax);
      const f = (u, v, h) => P(u, v, h);
      const faces = [];
      // side faces with outward normals (nu, nv); visible if the normal points towards the viewer
      const sides = [
        [[1, 0], [[b.u1, b.v0], [b.u1, b.v1]]], [[-1, 0], [[b.u0, b.v1], [b.u0, b.v0]]],
        [[0, 1], [[b.u1, b.v1], [b.u0, b.v1]]], [[0, -1], [[b.u0, b.v0], [b.u1, b.v0]]],
      ];
      for (const [[nu, nv], [[ua, va], [ub, vb]]] of sides) {
        const nD = -nu * sa + nv * ca;
        if (nD >= 0) continue;
        const shade = nu !== 0 ? 0.8 : 0.9;
        faces.push(`<polygon points="${pts([f(ua, va, 0), f(ub, vb, 0), f(ub, vb, z), f(ua, va, z)])}" fill="${rgb(col, shade)}"/>`);
      }
      faces.push(`<polygon points="${pts([f(b.u0, b.v0, z), f(b.u1, b.v0, z), f(b.u1, b.v1, z), f(b.u0, b.v1, z)])}" fill="${rgb(col)}"/>`);
      barsSvg += `<g class="bar3d" data-u="${b.c.u}" data-tip="${esc(cfg.tipFor(b.c))}" stroke="rgba(36,43,46,.55)" stroke-width=".7" stroke-linejoin="round">${faces.join("")}</g>`;
      const top = P((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, z);
      labels += `<text x="${top[0].toFixed(1)}" y="${(top[1] - 9).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#242424" stroke="#fff" stroke-width="3" paint-order="stroke" pointer-events="none">${cfg.fmtValue(z)}</text>`;
    }
    g += barsSvg + (bars.length <= 16 && !narrow ? labels : "");
    box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="${esc(cfg.ariaLabel || "")}">${g}</svg>`;
  }

  /* Drag on any figure rotates all of them. */
  function attachRotate(boxes, rerender) {
    let drag = null, raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(rerender); };
    for (const box of boxes) {
      box.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        drag = { x: ev.clientX, y: ev.clientY, az: view.az, el: view.el, id: ev.pointerId, box, moved: false };
        box.setPointerCapture(ev.pointerId);
      });
      box.addEventListener("pointermove", (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true; box.classList.add("dragging");
        view.az = drag.az - dx * 0.45;
        view.el = Math.min(70, Math.max(8, drag.el + dy * 0.3));
        schedule();
      });
      const end = (ev) => { if (drag && drag.id === ev.pointerId) { drag.box.classList.remove("dragging"); drag = null; } };
      box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
    }
  }
  const resetView = () => Object.assign(view, DEFAULT_VIEW);

  root.Profile3D = { render, attachRotate, resetView, plasma, niceTop, view };
})(window);
