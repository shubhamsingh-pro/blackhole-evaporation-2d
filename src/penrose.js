// Penrose (conformal) diagram of a black hole that forms from a collapsing shell and then
// evaporates completely: the "traditional" Hawking picture.
//
// This is a schematic. Positions are chosen by hand, but they obey the rules that matter:
//   - radial null rays are drawn at exactly 45 degrees,
//   - the singularity is spacelike (flatter than 45 degrees),
//   - the apparent horizon is timelike (steeper than 45 degrees),
//   - the event horizon is a null ray, the "last ray" that reaches I+,
//   - after the evaporation point P the centre r = 0 reappears, shifted to the right.
// The geometry lives in pure functions so it can be tested in Node; draw() only needs a canvas context.
//
// Diagram coordinates: x to the right (r = 0 is the left edge), y up (time).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Penrose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = {
    iMinus: [0, -1],       // past timelike infinity (bottom of the centre line)
    iZero: [1, 0],         // spatial infinity
    iPlus: [0.3, 0.7],     // future timelike infinity (top of the new centre line)
    shellFoot: [0.55, -0.45], // where the collapsing null shell leaves I-
    A: [0, 0.10],          // where the shell reaches r = 0: the singularity forms here
    P: [0.3, 0.30],        // the evaporation point: horizon and singularity both end here
    H: [0.05, 0.05],       // where the event horizon (the last ray, traced back) meets the shell
    uEH: [0.5, 0.5],       // where the last ray reaches I+
    AH0: [0.2, -0.10],     // apparent horizon forms on the shell here
    AHc: [0.31, 0.12],     // Bezier control point: makes the apparent horizon steep and timelike
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const SING_SLOPE = (G.P[1] - G.A[1]) / (G.P[0] - G.A[0]); // 2/3: spacelike

  // The singularity: straight spacelike segment from A to P.
  function sing(x) { return G.A[1] + SING_SLOPE * x; }

  // The apparent horizon as a function of s in [0, 1] (s = fraction of the lifetime).
  function ah(s) {
    s = clamp(s, 0, 1);
    const u = 1 - s;
    return [
      u * u * G.AH0[0] + 2 * u * s * G.AHc[0] + s * s * G.P[0],
      u * u * G.AH0[1] + 2 * u * s * G.AHc[1] + s * s * G.P[1],
    ];
  }
  // Tangent of the apparent horizon (dx, dy) at s.
  function ahTangent(s) {
    s = clamp(s, 0, 1);
    const u = 1 - s;
    return [
      2 * u * (G.AHc[0] - G.AH0[0]) + 2 * s * (G.P[0] - G.AHc[0]),
      2 * u * (G.AHc[1] - G.AH0[1]) + 2 * s * (G.P[1] - G.AHc[1]),
    ];
  }

  // I+ is the line y = 1 - x. An outgoing null ray from (x, y) travels along y' = y + (x' - x).
  function landing(p) {
    const x = (1 - p[1] + p[0]) / 2;
    return [x, 1 - x];
  }
  // I- is the line y = x - 1. An ingoing null ray arrives from there: x_start = (x + y + 1) / 2.
  function origin(p) { return (p[0] + p[1] + 1) / 2; }
  // An ingoing ray (up and to the left) from point p hits the singularity here (or null if it misses).
  function partnerHit(p) {
    const t = (sing(p[0]) - p[1]) / (1 + SING_SLOPE); // y + t = sing(x - t)
    // t = 0 happens exactly at the evaporation point P, where the ray has zero length
    return t > -1e-9 && p[0] - t >= -1e-9 ? [Math.max(0, p[0] - t), p[1] + Math.max(0, t)] : null;
  }
  // The ingoing ray that left I- at x = xs, and where it meets the singularity.
  function infallHit(xs) {
    const x = (2 * xs - 1 - G.A[1]) / (1 + SING_SLOPE); // 2xs - 1 - x = sing(x)
    if (x < -1e-9 || x > G.P[0] + 1e-9) return null;
    return [Math.max(0, x), 2 * xs - 1 - Math.max(0, x)];
  }
  // The "nice slice" at time fraction f: from i0 to the apparent horizon, then inwards at a
  // spacelike slope until it reaches the singularity (or the regular centre at x = 0).
  function sliceInner(p, slope = 0.45) {
    let x = p[0];
    const step = 0.002;
    while (x > 0) {
      const y = p[1] + slope * (p[0] - x);
      if (y >= sing(x) && x <= G.P[0]) return [x, y];
      x -= step;
    }
    return [0, p[1] + slope * p[0]];
  }
  // The shell: y = A_y - x (an ingoing null ray).
  const shellY = (x) => G.A[1] - x;

  // ------------------------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------------------------

  // st = {
  //   f (0..1 fraction of the evaporation time), evaporated, mode ('hawking'|'holographic'),
  //   pageF, colorAt(s, alpha), message: {fSent, k, recovered, tRec: [fractions]} | null,
  //   labels: bool
  // }
  function draw(ctx, W, H, st) {
    const S = Math.min((W - 96) / 1.0, (H - 96) / 1.75);
    const ox = 48, oy = 44;
    const X = (x) => ox + x * S;
    const Y = (y) => oy + (0.75 - y) * S;
    const pt = (p) => [X(p[0]), Y(p[1])];
    const line = (a, b) => { const A = pt(a), B = pt(b); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); };
    const dot = (p, r, col) => { const q = pt(p); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fill(); };
    const text = (str, p, dx, dy, col, size, align) => {
      const q = pt(p); ctx.fillStyle = col || '#8b94a8'; ctx.font = (size || 19) + 'px system-ui, sans-serif';
      ctx.textAlign = align || 'start'; ctx.fillText(str, q[0] + (dx || 0), q[1] + (dy || 0)); ctx.textAlign = 'start';
    };
    const f = clamp(st.f, 0, 1);
    const holo = st.mode === 'holographic';

    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // --- regions ---
    ctx.fillStyle = 'rgba(210,70,60,0.10)'; // black hole interior
    ctx.beginPath(); let q = pt(G.A); ctx.moveTo(q[0], q[1]);
    q = pt(G.H); ctx.lineTo(q[0], q[1]); q = pt(G.P); ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(90,140,255,0.07)'; // flat space again, after evaporation
    ctx.beginPath(); q = pt(G.P); ctx.moveTo(q[0], q[1]);
    q = pt(G.uEH); ctx.lineTo(q[0], q[1]); q = pt(G.iPlus); ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill();

    // --- boundaries of the spacetime ---
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#7d869b';
    line(G.iMinus, G.A);            // regular centre, before the collapse
    line(G.P, G.iPlus);             // centre again, after the evaporation
    line(G.iMinus, G.iZero);        // I-
    line(G.iZero, G.iPlus);         // I+
    [G.iMinus, G.iZero, G.iPlus].forEach((p) => dot(p, 4.5, '#cfd6e4'));

    // --- radiation arriving on I+ so far (colour = temperature) ---
    const n = Math.max(2, Math.round(f * 80));
    ctx.lineWidth = 6;
    for (let i = 0; i < n; i++) {
      const s0 = (i / n) * f, s1 = ((i + 1) / n) * f;
      ctx.strokeStyle = st.colorAt(s0, 0.95);
      line(landing(ah(s0)), landing(ah(s1)));
    }

    // --- the collapsing shell ---
    ctx.lineWidth = 3; ctx.strokeStyle = '#e8b04a';
    line(G.shellFoot, G.A);

    // --- event horizon: null, the last ray, dotted all the way to I+ ---
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.setLineDash([2, 7]);
    line(G.H, G.uEH); ctx.setLineDash([]);

    // --- stretched horizon (the paper): a timelike surface just outside the apparent horizon ---
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(103,227,255,0.45)'; ctx.setLineDash([6, 6]);
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) { const a = ah(i / 60); const b = pt([a[0] + 0.028, a[1]]); i ? ctx.lineTo(b[0], b[1]) : ctx.moveTo(b[0], b[1]); }
    ctx.stroke(); ctx.setLineDash([]);

    // --- apparent horizon: faint for the future, bright for the past ---
    const drawAH = (s0, s1, col, w) => {
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
      for (let i = 0; i <= 50; i++) { const a = pt(ah(s0 + (s1 - s0) * i / 50)); i ? ctx.lineTo(a[0], a[1]) : ctx.moveTo(a[0], a[1]); }
      ctx.stroke();
    };
    drawAH(f, 1, 'rgba(255,150,70,0.35)', 3);
    drawAH(0, f, 'rgba(255,150,70,1)', 4);

    // --- the singularity (wavy, spacelike) ---
    ctx.lineWidth = 3; ctx.strokeStyle = '#ff5a4d'; ctx.beginPath();
    const A = pt(G.A), P = pt(G.P), L = Math.hypot(P[0] - A[0], P[1] - A[1]);
    const nx = -(P[1] - A[1]) / L, ny = (P[0] - A[0]) / L;
    for (let i = 0; i <= 80; i++) {
      const u = i / 80, w = Math.sin(u * L / 5.5) * 3.2;
      const x = A[0] + (P[0] - A[0]) * u + nx * w, y = A[1] + (P[1] - A[1]) * u + ny * w;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // --- Hawking pairs created so far: one out to I+, the partner into the singularity ---
    for (let s = 0.03; s <= f + 1e-9; s += 0.055) {
      const a = ah(s), land = landing(a), hit = partnerHit(a);
      ctx.lineWidth = 1.6; ctx.strokeStyle = st.colorAt(s, 0.75); line(a, land);
      if (hit) { ctx.strokeStyle = 'rgba(110,150,255,0.5)'; line(a, hit); }
    }

    // --- the message ---
    const msg = st.message;
    if (msg) {
      const fs = clamp(msg.fSent, 0, 1), a = ah(fs), xs = origin(a);
      const hit = partnerHit(a);
      ctx.lineWidth = 3; ctx.strokeStyle = '#67e3ff';
      line([xs, xs - 1], a); // it falls in along an ingoing null ray
      if (holo) {
        // seen from outside it stays on the stretched horizon (bits on the horizon), then leaves in the radiation
        ctx.setLineDash([3, 6]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(103,227,255,0.55)';
        if (hit) line(a, hit); // the infalling observer's own view: smooth passage inside
        ctx.setLineDash([]);
        const stored = 1 - (msg.recovered / Math.max(1, msg.k));
        if (f > fs && stored > 0) { drawAH(fs, f, `rgba(103,227,255,${0.35 + 0.6 * stored})`, 7); }
        ctx.lineWidth = 2;
        msg.tRec.forEach((tr) => {
          const b = ah(clamp(tr, 0, 1));
          ctx.strokeStyle = 'rgba(103,227,255,0.8)'; line(b, landing(b));
        });
      } else if (hit) {
        ctx.lineWidth = 3; line(a, hit);
        const h = pt(hit); ctx.strokeStyle = '#ff7a6a'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(h[0] - 9, h[1] - 9); ctx.lineTo(h[0] + 9, h[1] + 9); ctx.moveTo(h[0] + 9, h[1] - 9); ctx.lineTo(h[0] - 9, h[1] + 9); ctx.stroke();
      }
      dot([xs, xs - 1], 5, '#67e3ff');
    }

    // --- the Page time on the apparent horizon ---
    const pg = ah(st.pageF);
    dot(pg, 5.5, '#ffb347');

    // --- "now": the slice and its marker ---
    const now = ah(f);
    const inner = sliceInner(now);
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); // outside part: i0 -> now (a gentle spacelike curve)
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, x = G.iZero[0] + (now[0] - G.iZero[0]) * u;
      const y = G.iZero[1] + (now[1] - G.iZero[1]) * (u * u * (3 - 2 * u));
      const c = pt([x, y]); i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1]);
    }
    ctx.stroke();
    ctx.setLineDash([7, 5]); line(now, inner); ctx.setLineDash([]); // inside the hole
    dot(now, 7, '#ffffff'); dot(inner, 4, '#ffffff');

    // --- the final burst ---
    if (st.evaporated) {
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; line(G.P, G.uEH);
      dot(G.uEH, 7, '#ffffff'); dot(G.P, 7, '#ffffff');
    }

    // --- labels ---
    const c1 = '#8b94a8', c2 = '#cfd6e4';
    text('r = 0', [0, -0.55], 8, 0, c1, 18);
    text('r = 0', G.iPlus, -8, 16, c1, 18, 'end'); // after evaporation, shifted over
    text('I⁻', [0.5, -0.5], 10, 24, c2, 20);
    text('I⁺', [0.78, 0.22], 14, -4, c2, 20);
    text('i⁻', G.iMinus, -4, 26, c2, 20, 'end'); text('i⁰', G.iZero, 12, 6, c2, 20); text('i⁺', G.iPlus, 0, -12, c2, 20, 'center');
    text('shell', [0.40, -0.30], 6, 0, '#e8b04a', 18);
    text('singularity', [0.0, 0.34], 6, 0, '#ff7a6a', 18);
    text('P', G.P, -12, -12, '#ffffff', 20, 'end');
    text('last ray', [0.48, 0.47], 10, 6, 'rgba(255,255,255,0.8)', 17);
    text('now', now, 14, 22, '#ffffff', 19);
    text('Page time', pg, 12, 20, '#ffb347', 17);
    text('flat again', [0.3, 0.55], -10, 0, 'rgba(120,160,255,0.8)', 17, 'end');
    if (msg) text(holo ? 'message' : 'message', [origin(ah(clamp(msg.fSent, 0, 1))), origin(ah(clamp(msg.fSent, 0, 1))) - 1], 10, -8, '#67e3ff', 17);
    if (!msg) text('(send a message below)', [0.5, -0.88], 0, 0, '#5d667d', 16, 'center');
  }

  return { G, sing, ah, ahTangent, landing, origin, partnerHit, infallHit, sliceInner, shellY, draw, SING_SLOPE };
});
