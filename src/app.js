// Browser front end: rendering, controls and HUD for BHCore.BlackHoleSim.
(function () {
  'use strict';

  const view = document.getElementById('view');
  const ctx = view.getContext('2d');
  const plot = document.getElementById('plot');
  const pctx = plot.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const VIEW_RADIUS = 16; // world units from centre to canvas edge
  const W = view.width, H = view.height;
  const scale = (W / 2) / VIEW_RADIUS;
  const sx = (x) => W / 2 + x * scale;
  const sy = (y) => H / 2 - y * scale;

  // Optional URL parameters:
  //   ?t=60       start 60 s into the run        ?life=120   evaporation time in seconds
  //   ?mode=hawking | holographic                 ?send=0     send the message at t = 0 s
  const params = new URLSearchParams(location.search);
  if (params.has('life')) {
    const L = Math.min(240, Math.max(15, +params.get('life') || 90));
    $('life').value = L; $('v-life').textContent = L + ' s';
  }
  const currentMode = () => document.querySelector('input[name=imode]:checked').value;
  if (['hawking', 'holographic'].includes(params.get('mode'))) {
    document.querySelector(`input[name=imode][value=${params.get('mode')}]`).checked = true;
  }

  // The message: a 6x6 picture (36 bits).
  const MSG_W = 6;
  const MSG_BITS = [
    0,0,0,0,0,0,
    0,1,0,0,1,0,
    0,1,0,0,1,0,
    0,0,0,0,0,0,
    1,0,0,0,0,1,
    0,1,1,1,1,0,
  ];

  const sim = new BHCore.BlackHoleSim({
    lifetime: +$('life').value, seed: Date.now() & 0xffff, emitRate: 40, infoMode: currentMode(),
  });
  sim.addDustRing(350, 7, 12);
  if (params.has('t') || params.has('send')) {
    const target = Math.max(0, +params.get('t') || 0);
    const sendAt = params.has('send') ? Math.max(0, +params.get('send') || 0) : null;
    if (sendAt === 0) sim.sendMessage(MSG_BITS);
    while (sim.t < target && !(sim.evaporated && sim.t - sim.burstTime > 2.5)) {
      sim.step(1 / 60);
      if (sendAt !== null && !sim.message && sim.t >= sendAt) sim.sendMessage(MSG_BITS);
    }
  }

  let paused = false;
  let speed = 1;
  let flash = 0; // brightness of the final-burst flash, 0..1
  let last = performance.now();

  // Temperature -> colour: cool red -> orange -> yellow -> white -> blue-white.
  function tempColor(T, alpha) {
    const u = Math.min(1, Math.log10(Math.max(T, 1)) / 1.4); // T from 1x to ~25x
    const stops = [
      [0.00, [255, 80, 50]],
      [0.30, [255, 160, 60]],
      [0.55, [255, 235, 160]],
      [0.80, [255, 255, 255]],
      [1.00, [150, 190, 255]],
    ];
    let i = 0;
    while (i < stops.length - 2 && u > stops[i + 1][0]) i++;
    const [u0, c0] = stops[i], [u1, c1] = stops[i + 1];
    const f = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
    const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  function drawView() {
    // fading trails
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, W, H);

    const rs = sim.rs;

    if (!sim.evaporated) {
      // faint glow around the horizon, warmer as the hole heats up
      const g = ctx.createRadialGradient(sx(0), sy(0), rs * scale, sx(0), sy(0), rs * scale * 2.2);
      g.addColorStop(0, tempColor(sim.temperature, 0.35));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx(0), sy(0), rs * scale * 2.2, 0, 7); ctx.fill();

      if ($('guides').checked) {
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(120,160,255,0.35)';
        ctx.beginPath(); ctx.arc(sx(0), sy(0), sim.photonSphere * scale, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,255,180,0.30)';
        ctx.beginPath(); ctx.arc(sx(0), sy(0), sim.isco * scale, 0, 7); ctx.stroke();
        ctx.restore();
      }

      // the hole itself
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(sx(0), sy(0), rs * scale, 0, 7); ctx.fill();
      ctx.strokeStyle = tempColor(sim.temperature, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(0), sy(0), rs * scale, 0, 7); ctx.stroke();
    }

    // dust
    ctx.fillStyle = 'rgba(150,170,200,0.85)';
    for (const p of sim.dust) {
      const x = sx(p.x), y = sy(p.y);
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    // negative-energy partners falling in
    for (const gh of sim.ghosts) {
      const a = 0.5 * (1 - gh.age / gh.life);
      ctx.fillStyle = `rgba(110,140,255,${a})`;
      ctx.beginPath(); ctx.arc(sx(gh.x), sy(gh.y), 2.5, 0, 7); ctx.fill();
    }

    // Hawking quanta
    for (const q of sim.photons) {
      const x = sx(q.x), y = sy(q.y);
      if (q.info) { // a quantum carrying one bit of the message: filled = 1, hollow = 0
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(103,227,255,0.95)';
        ctx.fillStyle = 'rgba(103,227,255,0.9)';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 7);
        if (q.bit) ctx.fill();
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = tempColor(q.T, 0.95);
      const s = q.T > 10 ? 4 : 3;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    if (flash > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.55);
      g.addColorStop(0, `rgba(255,255,255,${flash})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    if (sim.evaporated) {
      ctx.fillStyle = 'rgba(230,236,250,0.9)';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Fully evaporated. Gravity is gone and the dust flies off in straight lines.', W / 2, H - 24);
      ctx.textAlign = 'start';
    }
  }

  function drawPlot() {
    const w = plot.width, h = plot.height, pad = 22;
    pctx.clearRect(0, 0, w, h);
    pctx.strokeStyle = '#1b2030'; pctx.lineWidth = 1;
    pctx.strokeRect(pad, 8, w - pad - 8, h - pad - 8);
    const X = (t) => pad + (t / sim.lifetime) * (w - pad - 8);
    const Y = (m) => 8 + (1 - m) * (h - pad - 8);

    pctx.strokeStyle = 'rgba(255,255,255,0.33)';
    pctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * sim.lifetime;
      const m = sim.massAt(t);
      i ? pctx.lineTo(X(t), Y(m)) : pctx.moveTo(X(t), Y(m));
    }
    pctx.stroke();

    pctx.strokeStyle = '#7fb0ff'; pctx.lineWidth = 2;
    pctx.beginPath();
    sim.history.forEach((p, i) => (i ? pctx.lineTo(X(Math.min(p.t, sim.lifetime)), Y(p.m)) : pctx.moveTo(X(p.t), Y(p.m))));
    pctx.stroke();

    pctx.fillStyle = '#8b94a8'; pctx.font = '16px system-ui, sans-serif';
    pctx.fillText('M', 4, 20); pctx.fillText('t →', w - 36, h - 4);
  }

  function updateHud() {
    $('s-mass').textContent = sim.m.toFixed(3);
    $('s-rs').textContent = sim.rs.toFixed(2);
    $('s-temp').textContent = sim.evaporated ? '∞' : sim.temperature.toFixed(1) + '×';
    $('s-lum').textContent = sim.evaporated ? '∞' : sim.luminosity.toFixed(1) + '×';
    $('s-left').textContent = sim.evaporated ? '0 s' : sim.timeRemaining.toFixed(1) + ' s';
    $('s-swal').textContent = sim.swallowed;
    $('pause').textContent = paused ? 'Resume' : 'Pause';
  }


  // ---- Equations column: each rule the simulation uses, with its live value -------------
  const R_SAMPLE = 9; // radius used to show the orbital speed
  const eqRows = [
    ['r<sub>s</sub> = 2GM/c² = 2m', () => sim.rs.toFixed(3), 'Horizon radius. Units: m = 1 at the start, so r<sub>s</sub> = 2.'],
    ['GM = c² · m', () => sim.gm.toFixed(2), 'Gravity strength (c = ' + sim.c + ' units/s).'],
    ['dm/dt = −a / m²', () => (sim.evaporated ? '0' : (-sim.a / (sim.m * sim.m)).toFixed(4) + ' /s'), 'Mass loss rate: the lighter the hole, the faster it loses mass.'],
    ['a = m<sub>0</sub>³ / (3τ)', () => sim.a.toFixed(5), 'Constant that sets the lifetime τ.'],
    ['m(t) = (m<sub>0</sub>³ − 3at)<sup>1/3</sup>', () => sim.massAt(sim.t).toFixed(4), 'Exact solution of the line above (the grey curve in the plot).'],
    ['τ = m<sub>0</sub>³ / 3a', () => sim.lifetime.toFixed(0) + ' s', 'Total lifetime, set by the slider.'],
    ['t<sub>left</sub> = m³ / 3a', () => sim.timeRemaining.toFixed(2) + ' s', 'Time remaining at the current mass.'],
    ['T ∝ 1/m', () => (sim.evaporated ? '∞' : sim.temperature.toFixed(2) + '×'), 'Temperature relative to the start. Sets the colour of the quanta.'],
    ['L ∝ 1/m²', () => (sim.evaporated ? '∞' : sim.luminosity.toFixed(2) + '×'), 'Radiated power relative to the start (T⁴ × area ∝ 1/m²).'],
    ['N ∝ L / ⟨E⟩ ∝ 1/m', () => (sim.evaporated ? '–' : (sim.emitRate / sim.m).toFixed(1) + ' /s'), 'Quanta emitted per second.'],
    ['a(r) = −GM / (r − r<sub>s</sub>)²', () => (sim.evaporated ? '0' : (-sim.gm / Math.pow(R_SAMPLE - sim.rs, 2)).toFixed(3)), 'Paczyński–Wiita gravity, shown at r = ' + R_SAMPLE + '.'],
    ['v<sub>circ</sub>² = GM·r / (r − r<sub>s</sub>)²', () => (sim.evaporated ? '–' : sim.circularSpeed(R_SAMPLE).toFixed(3) + ' (r=' + R_SAMPLE + ')'), 'Circular orbit speed at that radius.'],
    ['r<sub>photon</sub> = 3m', () => sim.photonSphere.toFixed(3), 'Photon sphere (dashed blue circle).'],
    ['r<sub>ISCO</sub> = 6m', () => sim.isco.toFixed(3), 'Innermost stable circular orbit (dashed green circle).'],
  ];

  const eqSimEl = $('eq-sim');
  eqSimEl.innerHTML = eqRows.map((r, i) =>
    `<div class="eq"><span class="f">${r[0]}</span><span class="v" id="eqv-${i}"></span><span class="d">${r[2]}</span></div>`
  ).join('');
  const eqValEls = eqRows.map((_, i) => $('eqv-' + i));

  const checkEl = $('eq-check');
  checkEl.innerHTML =
    '<div class="eq"><span class="f">m<sub>sim</sub></span><span class="v" id="ck-sim"></span><span class="d">Mass the simulation is actually using.</span></div>' +
    '<div class="eq"><span class="f">m<sub>exact</sub> = (m<sub>0</sub>³ − 3at)<sup>1/3</sup></span><span class="v" id="ck-exact"></span><span class="d">Formula evaluated at the current time.</span></div>' +
    '<div class="eq"><span class="f">|m<sub>sim</sub> − m<sub>exact</sub>|</span><span class="v" id="ck-diff"></span><span class="d" id="ck-note"></span></div>' +
    '<div class="eq"><span class="f">m<sub>sim</sub>³ + 3a·t</span><span class="v" id="ck-inv"></span><span class="d">Should stay equal to m<sub>0</sub>³ = 1 the whole run (a conserved quantity of the law).</span></div>';
  const ck = { sim: $('ck-sim'), exact: $('ck-exact'), diff: $('ck-diff'), note: $('ck-note'), inv: $('ck-inv') };

  let eqTick = 0;
  let paperTick = 0;
  function updatePaperRows() {
    if ((paperTick++ % 6) !== 0) return;
    paperRows.forEach((r, i) => { paperValEls[i].textContent = r[1](); });
    const t = $('tau-ref'); if (t) t.textContent = sim.lifetime.toFixed(0);
  }

  function updateEquations() {
    if ((eqTick++ % 6) !== 0) return; // ~10 Hz is plenty
    eqRows.forEach((r, i) => { eqValEls[i].textContent = r[1](); });

    const exact = sim.massAt(sim.t);
    ck.sim.textContent = sim.m.toFixed(6);
    ck.exact.textContent = exact.toFixed(6);
    const setStatus = (cls, text, note) => { ck.diff.className = 'v ' + cls; ck.diff.textContent = text; ck.note.textContent = note; };

    if (sim.evaporated) {
      setStatus('na', 'n/a', 'The hole reached the final burst at m = ' + sim.mMin + ', so the smooth law no longer applies.');
      ck.inv.className = 'v na'; ck.inv.textContent = 'n/a';
    } else if (sim.accrete && sim.swallowed > 0) {
      setStatus('na', 'n/a', 'Accretion is on: swallowed dust adds mass, so the simulation is meant to differ from the formula.');
      ck.inv.className = 'v na'; ck.inv.textContent = 'n/a';
    } else {
      const d = Math.abs(sim.m - exact);
      setStatus(d < 1e-6 ? 'ok' : 'bad', d.toExponential(1) + (d < 1e-6 ? '  ✓' : '  ✗'), 'Should be below 1e-6; it is exact up to floating-point rounding.');
      const inv = Math.pow(sim.m, 3) + 3 * sim.a * sim.t;
      ck.inv.className = 'v ' + (Math.abs(inv - 1) < 1e-6 ? 'ok' : 'bad');
      ck.inv.textContent = inv.toFixed(6) + (Math.abs(inv - 1) < 1e-6 ? '  ✓' : '  ✗');
    }
  }


  // ---- Paper equations (live) -----------------------------------------------------------
  const paperRows = [
    ['S = A/4G = (A/l<sub>p</sub>²) ln 2', () => sim.bitsCapacity.toFixed(1) + ' bits', 'Eq. 1.3: one bit per Planck area. Here the area scales as m², starting from ' + sim.N0 + ' bits.'],
    ['t<sub>h</sub> = 4MG', () => sim.horizonTimeScale.toFixed(3) + ' s', 'Eq. 4.4: a Schwarzschild time t is a boost by t/4MG. In these units 4GM/c³ = 4m/c.'],
    ['R<sub>⊥</sub>² = ρ<sub>0</sub>² e<sup>t/4MG</sup>', () => (sim.message && !sim.evaporated ? (100 * sim.messageSpread).toFixed(0) + '% of ring' : '–'), 'Eq. 4.15: how far the message has spread over the stretched horizon (grows exponentially).'],
    ['t<sub>spread</sub> = 4MG ln(M²G²)', () => (sim.evaporated ? '–' : sim.scramblingTime.toFixed(2) + ' s'), 'Eq. 4.10: time to cover the horizon. Compare τ = ' + '<span id="tau-ref"></span> s: far shorter.'],
    ['S<sub>rad</sub> (Hawking) = 4/3 · ΔS<sub>BH</sub>', () => sim.hawkingRadEntropy.toFixed(1) + ' bits', 'Thermal radiation only ever adds entropy; it ends above the starting ' + sim.N0 + ' bits.'],
    ['S<sub>Page</sub> = min(S<sub>rad</sub>, S<sub>BH</sub>)', () => sim.pageEntropy.toFixed(1) + ' bits', 'Page (the paper\'s ref. 20): if the process is unitary the radiation entropy cannot exceed the hole\'s.'],
    ['t<sub>Page</sub> = τ (1 − (4/7)<sup>3/2</sup>)', () => sim.pageTime.toFixed(1) + ' s', 'When S<sub>rad</sub> = S<sub>BH</sub>, about 57% of the way through. After it, information leaves.'],
  ];
  $('eq-paper').innerHTML = paperRows.map((r, i) =>
    `<div class="eq"><span class="f">${r[0]}</span><span class="v" id="pv-${i}"></span><span class="d">${r[2]}</span></div>`
  ).join('');
  const paperValEls = paperRows.map((_, i) => $('pv-' + i));

  // ---- Information panel: horizon screen, entropy curves, message ------------------------
  const scr = $('screen'), sctx = scr.getContext('2d');
  const pg = $('page'), gctx = pg.getContext('2d');
  const mg = $('msg'), mctx = mg.getContext('2d');
  const CYAN = '#67e3ff', AMBER = '#ffb347';
  const TAU2 = Math.PI * 2;

  const pixelBit = (i) => (Math.imul(i + 1, 2654435761) >>> 9) & 1; // stable "thermal" pixel values

  function drawScreen() {
    const w = scr.width, h = scr.height, cx = w / 2, cy = h / 2;
    sctx.fillStyle = '#05070d'; sctx.fillRect(0, 0, w, h);

    const P = sim.evaporated ? 0 : Math.max(0, Math.round(sim.bitsCapacity));
    const R = Math.min(165, Math.max(34, 150 * sim.m));
    const g = sim.message;
    const mapAng = (th) => -th; // maths angle (counter-clockwise) -> canvas angle

    // faint horizon disc
    if (!sim.evaporated) {
      sctx.fillStyle = '#000'; sctx.beginPath(); sctx.arc(cx, cy, R, 0, TAU2); sctx.fill();
    }

    // the pixels: lit = 1, dim = 0 (a thermal-looking pattern)
    for (let i = 0; i < P; i++) {
      const th = TAU2 * (i + 0.5) / P;
      const wpx = Math.max(1.2, Math.min(8, (TAU2 * R / P) * 0.72));
      sctx.strokeStyle = pixelBit(i) ? 'rgba(150,170,205,0.85)' : 'rgba(55,65,92,0.85)';
      sctx.lineWidth = wpx;
      sctx.beginPath();
      sctx.moveTo(cx + R * Math.cos(th), cy - R * Math.sin(th));
      sctx.lineTo(cx + (R + 11) * Math.cos(th), cy - (R + 11) * Math.sin(th));
      sctx.stroke();
    }

    if (g && !sim.evaporated) {
      // the region disturbed so far (eq. 4.15), growing at the causal limit
      if (sim.messageSpread < 1) {
        sctx.strokeStyle = AMBER; sctx.lineWidth = 4; sctx.globalAlpha = 0.8;
        sctx.beginPath();
        sctx.arc(cx, cy, R - 7, mapAng(g.theta0 + sim.messageFront), mapAng(g.theta0 - sim.messageFront));
        sctx.stroke(); sctx.globalAlpha = 1;
      }
      // the message bits still stored on the horizon
      for (const j of sim.messageOnHorizon()) {
        const th = sim.messageBitAngle(j);
        const x = cx + (R + 22) * Math.cos(th), y = cy - (R + 22) * Math.sin(th);
        sctx.lineWidth = 2; sctx.strokeStyle = CYAN; sctx.fillStyle = CYAN;
        sctx.beginPath(); sctx.arc(x, y, 5, 0, TAU2);
        if (g.bits[j]) sctx.fill();
        sctx.stroke();
      }
      // the arc a local observer reads (only while something is left on the horizon to read)
      if (sim.messageOnHorizon().length) {
        const f = +$('arc').value / 100;
        sctx.strokeStyle = 'rgba(255,255,255,0.55)'; sctx.lineWidth = 2; sctx.setLineDash([2, 5]);
        sctx.beginPath();
        sctx.arc(cx, cy, R + 38, mapAng(g.theta0 + Math.PI * f), mapAng(g.theta0 - Math.PI * f));
        sctx.stroke(); sctx.setLineDash([]);
      }
    }

    sctx.fillStyle = '#8b94a8'; sctx.font = '15px system-ui, sans-serif'; sctx.textAlign = 'center';
    if (sim.evaporated) {
      sctx.fillStyle = '#cfd6e4';
      sctx.fillText('No horizon left: 0 bits', cx, cy - 4);
      sctx.fillStyle = '#8b94a8';
      sctx.fillText(sim.infoMode === 'hawking' ? 'the information went with it' : 'everything is in the radiation', cx, cy + 16);
    } else {
      sctx.fillText(P + ' bits', cx, cy + 5);
    }
    sctx.textAlign = 'start';
  }

  function drawPage() {
    const w = pg.width, h = pg.height, L = 46, Rr = 14, T = 22, B = 36;
    gctx.fillStyle = '#05070d'; gctx.fillRect(0, 0, w, h);
    const ymax = (4 / 3) * sim.N0 * 1.08, tau = sim.lifetime;
    const X = (t) => L + (t / tau) * (w - L - Rr);
    const Y = (v) => h - B - (v / ymax) * (h - T - B);
    const holo = sim.infoMode === 'holographic';

    gctx.strokeStyle = '#1b2030'; gctx.lineWidth = 1;
    gctx.strokeRect(L, T, w - L - Rr, h - T - B);
    // initial entropy line
    gctx.setLineDash([3, 5]); gctx.strokeStyle = '#3a4468';
    gctx.beginPath(); gctx.moveTo(L, Y(sim.N0)); gctx.lineTo(w - Rr, Y(sim.N0)); gctx.stroke(); gctx.setLineDash([]);
    gctx.fillStyle = '#7d869b'; gctx.font = '13px system-ui, sans-serif';
    gctx.fillText('N₀ = ' + sim.N0, 6, Y(sim.N0) + 4);
    gctx.fillText('0', 30, Y(0) + 4);
    gctx.fillText('0', L - 2, h - B + 16); gctx.fillText(tau.toFixed(0) + ' s', w - Rr - 30, h - B + 16);
    gctx.fillText('entropy (bits)', 6, 14); gctx.fillText('time', (w + L) / 2 - 12, h - 8);

    // Page time marker
    gctx.strokeStyle = 'rgba(255,179,71,0.55)'; gctx.setLineDash([2, 4]);
    gctx.beginPath(); gctx.moveTo(X(sim.pageTime), T); gctx.lineTo(X(sim.pageTime), h - B); gctx.stroke(); gctx.setLineDash([]);
    gctx.fillStyle = 'rgba(255,179,71,0.9)'; gctx.fillText('Page time', X(sim.pageTime) - 24, T + 14);

    const curve = (key, color, width, alpha, dash) => {
      gctx.strokeStyle = color; gctx.lineWidth = width; gctx.globalAlpha = alpha; gctx.setLineDash(dash || []);
      gctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const t = (i / 200) * tau, v = sim.entropiesAt(t)[key];
        i ? gctx.lineTo(X(t), Y(v)) : gctx.moveTo(X(t), Y(v));
      }
      gctx.stroke(); gctx.globalAlpha = 1; gctx.setLineDash([]);
    };
    curve('cap', '#6ea8ff', 2.5, 1);
    curve('rad', '#ff7a6a', holo ? 1.5 : 2.5, holo ? 0.35 : 1, [6, 4]);
    curve('page', '#6ee7a0', 3, holo ? 1 : 0.25);

    // "now" marker
    const tn = Math.min(sim.t, tau), e = sim.entropiesAt(tn);
    gctx.strokeStyle = 'rgba(255,255,255,0.5)'; gctx.lineWidth = 1;
    gctx.beginPath(); gctx.moveTo(X(tn), T); gctx.lineTo(X(tn), h - B); gctx.stroke();
    const dot = (v, c) => { gctx.fillStyle = c; gctx.beginPath(); gctx.arc(X(tn), Y(v), 4.5, 0, TAU2); gctx.fill(); };
    dot(e.cap, '#6ea8ff'); dot(holo ? e.page : e.rad, holo ? '#6ee7a0' : '#ff7a6a');

    gctx.font = '15px system-ui, sans-serif';
    gctx.fillStyle = holo ? '#6ee7a0' : '#ff9a8c';
    gctx.fillText(holo ? 'Ends at 0: pure → pure' : 'Ends above N₀: pure → mixed', L + 10, T + 52);
    gctx.fillStyle = '#8b94a8';
    gctx.fillText(holo ? 'Information is returned.' : 'Information is lost.', L + 10, T + 72);
  }

  function drawMessage() {
    const w = mg.width, h = mg.height, cell = 36, gy = 46;
    mctx.fillStyle = '#05070d'; mctx.fillRect(0, 0, w, h);
    const g = sim.message;
    const grid = (x0, known, label, status) => {
      mctx.fillStyle = '#8b94a8'; mctx.font = '22px system-ui, sans-serif';
      mctx.fillText(label, x0, 30);
      for (let k = 0; k < MSG_W * MSG_W; k++) {
        const x = x0 + (k % MSG_W) * cell, y = gy + Math.floor(k / MSG_W) * cell;
        const isKnown = known(k);
        mctx.fillStyle = !isKnown ? '#0b0e16' : MSG_BITS[k] ? CYAN : '#1a2236';
        mctx.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        if (!isKnown) {
          mctx.strokeStyle = '#1f2638'; mctx.lineWidth = 1; mctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        }
      }
      if (status) { mctx.fillStyle = status.color; mctx.font = '20px system-ui, sans-serif'; mctx.fillText(status.text, x0, gy + MSG_W * cell + 24); }
    };
    grid(14, () => !!g, 'Sent', g ? null : { color: '#7d869b', text: 'not sent yet' });
    const got = g ? g.got : null;
    const nGot = g ? g.recovered : 0;
    let status = null;
    if (g && sim.infoMode === 'hawking') {
      status = sim.evaporated ? { color: '#ff9a8c', text: 'nothing returns: lost' } : { color: '#7d869b', text: 'waiting...' };
    } else if (g) {
      status = nGot === g.k ? { color: '#6ee7a0', text: 'all 36 bits match' } : { color: '#7d869b', text: nGot + ' / ' + g.k + ' bits received' };
    }
    grid(w / 2 + 14, (k) => !!(got && got[k]), 'Received', status);
  }

  function updateInfo() {
    drawScreen(); drawPage(); drawMessage();
    const g = sim.message;
    const holo = sim.infoMode === 'holographic';
    $('i-bits').textContent = (sim.evaporated ? 0 : Math.round(sim.bitsCapacity)) + ' / ' + sim.N0;
    $('send').disabled = !!g || sim.evaporated;
    $('i-back-l').textContent = holo ? 'Back in radiation' : 'Destroyed';
    if (!g) {
      $('i-state').textContent = 'not sent'; $('i-spread').textContent = '–'; $('i-back').textContent = '–';
      $('i-arc').textContent = 'Readable from this arc alone: –';
    } else {
      $('i-state').textContent = 'sent at t = ' + g.tSent.toFixed(1) + ' s';
      $('i-spread').textContent = sim.evaporated ? '–' : (100 * sim.messageSpread).toFixed(0) + '%';
      const on = sim.messageOnHorizon();
      $('i-back').textContent = holo ? g.recovered + ' / ' + g.k : (g.k - on.length) + ' / ' + g.k;

      // What a local observer can read from an arc of the horizon (paper section 6 / Page):
      // before scrambling the message sits in one place; afterwards an arc of fraction f
      // of the ring tells you nothing until f exceeds one half.
      const f = +$('arc').value / 100, s = sim.messageSpread;
      let inside = 0;
      for (const j of on) {
        const d = Math.abs(((sim.messageBitAngle(j) - g.theta0 + 3 * Math.PI) % TAU2) - Math.PI);
        if (d <= Math.PI * f) inside++;
      }
      const readable = Math.round((1 - s) * inside + s * Math.max(0, 2 * f - 1) * on.length);
      $('i-arc').textContent = on.length
        ? 'Readable from this arc alone: ' + readable + ' of ' + on.length + ' bits' + (s >= 1 && f <= 0.5 ? ' (it looks thermal)' : '')
        : 'Nothing left on the horizon to read.';
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) {
      const wasEvap = sim.evaporated;
      sim.step(dt * speed);
      if (!wasEvap && sim.evaporated) flash = 1;
    }
    flash *= 0.94;
    drawView();
    drawPlot();
    updateHud();
    updateEquations();
    updatePaperRows();
    updateInfo();
    requestAnimationFrame(frame);
  }

  function restart() {
    sim.lifetime = +$('life').value;
    sim.accrete = $('accrete').checked;
    sim.infoMode = currentMode();
    sim.reset();
    sim.addDustRing(350, 7, 12);
    flash = 0;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  }

  $('life').addEventListener('input', () => { $('v-life').textContent = $('life').value + ' s'; });
  $('life').addEventListener('change', restart); // lifetime changes the whole curve -> restart
  $('speed').addEventListener('input', () => { speed = +$('speed').value; $('v-speed').textContent = speed + '×'; });
  $('accrete').addEventListener('change', () => { sim.accrete = $('accrete').checked; });
  $('pause').addEventListener('click', () => { paused = !paused; });
  document.querySelectorAll('input[name=imode]').forEach((el) => el.addEventListener('change', restart)); // switching theory restarts the run
  $('send').addEventListener('click', () => { sim.sendMessage(MSG_BITS); });
  $('arc').addEventListener('input', () => { $('v-arc').textContent = $('arc').value + '%'; });
  $('reset').addEventListener('click', restart);
  $('dust').addEventListener('click', () => {
    if (!sim.evaporated) sim.addDustRing(150, Math.max(sim.isco + 0.5, 7), 13);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
    if (e.key === 'r') restart();
  });

  requestAnimationFrame(frame);
})();
