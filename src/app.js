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

  // Optional URL parameters: ?t=60 starts 60 s into the run, ?life=120 sets the evaporation time.
  const params = new URLSearchParams(location.search);
  if (params.has('life')) {
    const L = Math.min(240, Math.max(15, +params.get('life') || 90));
    $('life').value = L; $('v-life').textContent = L + ' s';
  }
  const sim = new BHCore.BlackHoleSim({
    lifetime: +$('life').value, seed: Date.now() & 0xffff, emitRate: 40,
  });
  sim.addDustRing(350, 7, 12);
  if (params.has('t')) {
    const target = Math.max(0, +params.get('t') || 0);
    while (sim.t < target && !(sim.evaporated && sim.t - sim.burstTime > 2.5)) sim.step(1 / 60);
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
    requestAnimationFrame(frame);
  }

  function restart() {
    sim.lifetime = +$('life').value;
    sim.accrete = $('accrete').checked;
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
