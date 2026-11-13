const test = require('node:test');
const assert = require('node:assert/strict');
const { BlackHoleSim } = require('../src/core.js');

test('mass follows the analytic law m^3 = m0^3 - 3at', () => {
  const sim = new BlackHoleSim({ lifetime: 60, emitRate: 0 });
  for (let i = 0; i < 20 * 60; i++) sim.step(1 / 60); // 20 s
  const expected = sim.massAt(sim.t);
  assert.ok(Math.abs(sim.m - expected) < 1e-6, `m=${sim.m} expected=${expected}`);
});

test('lifetime matches the configured value (pops near t = lifetime)', () => {
  const sim = new BlackHoleSim({ lifetime: 30, emitRate: 0, mMin: 0.01 });
  while (!sim.evaporated && sim.t < 100) sim.step(1 / 60);
  assert.ok(sim.evaporated);
  // popping at m = 0.01 happens just before the exact end (3a t = 1 - 1e-6)
  assert.ok(Math.abs(sim.burstTime - 30) < 0.05, `burst at ${sim.burstTime}`);
});

test('temperature rises and luminosity rises as the hole shrinks', () => {
  const sim = new BlackHoleSim({ lifetime: 20, emitRate: 0 });
  const T0 = sim.temperature, L0 = sim.luminosity;
  for (let i = 0; i < 10 * 60; i++) sim.step(1 / 60);
  assert.ok(sim.temperature > T0);
  assert.ok(sim.luminosity > L0);
  assert.ok(Math.abs(sim.rs - 2 * sim.m) < 1e-12);
});

test('circular orbit outside the ISCO stays circular (fixed mass)', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 0 }); // effectively static
  const r0 = 9;
  const v = sim.circularSpeed(r0);
  sim.dust.push({ x: r0, y: 0, vx: 0, vy: v });
  let rmin = Infinity, rmax = 0;
  for (let i = 0; i < 120 * 60; i++) { // 60 s ~ several orbits
    sim.step(1 / 60);
    const p = sim.dust[0];
    const r = Math.hypot(p.x, p.y);
    rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
  }
  assert.ok(rmax - rmin < 0.02 * r0, `radius drifted ${rmin}..${rmax}`);
});

test('orbits widen as the hole loses mass', () => {
  const sim = new BlackHoleSim({ lifetime: 120, emitRate: 0 });
  const r0 = 9;
  sim.dust.push({ x: r0, y: 0, vx: 0, vy: sim.circularSpeed(r0) });
  for (let i = 0; i < 100 * 60; i++) sim.step(1 / 60);
  const p = sim.dust[0];
  assert.ok(Math.hypot(p.x, p.y) > r0 * 1.5, 'orbit should have expanded');
});

test('dust inside the horizon is swallowed', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 0 });
  sim.dust.push({ x: 2.1, y: 0, vx: 0, vy: 0 });
  sim.step(0.5);
  assert.equal(sim.dust.length, 0);
  assert.equal(sim.swallowed, 1);
});

test('Hawking quanta are emitted outside the horizon and move outward-ish', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 60, seed: 7 });
  sim.step(1);
  assert.ok(sim.photons.length > 20);
  for (const q of sim.photons) {
    const r = Math.hypot(q.x, q.y);
    assert.ok(r > sim.rs, 'emitted outside horizon');
    assert.ok(Math.abs(Math.hypot(q.vx, q.vy) - sim.c) < 1e-9, 'photons move at c');
  }
});

test('final burst happens once and gravity switches off', () => {
  const sim = new BlackHoleSim({ lifetime: 5, emitRate: 0 });
  sim.dust.push({ x: 30, y: 0, vx: 0, vy: sim.circularSpeed(30) });
  while (!sim.evaporated && sim.t < 20) sim.step(1 / 60);
  assert.ok(sim.evaporated);
  const n = sim.photons.length;
  assert.ok(n >= 400);
  const before = { vx: sim.dust[0].vx, vy: sim.dust[0].vy };
  sim.step(0.1);
  assert.deepEqual({ vx: sim.dust[0].vx, vy: sim.dust[0].vy }, before, 'free flight after evaporation');
});

test('same seed gives identical runs', () => {
  const run = () => {
    const s = new BlackHoleSim({ seed: 42 });
    s.addDustRing(50);
    for (let i = 0; i < 600; i++) s.step(1 / 60);
    return JSON.stringify([s.m, s.dust.slice(0, 3), s.photons.length]);
  };
  assert.equal(run(), run());
});

test('regression: default 90 s run with emission finishes without hanging or NaN', () => {
  // The last substep can drop m from just above mMin to exactly 0; emission divides by m.
  for (const dt of [1 / 60, 1 / 30, 0.05, 0.2]) {
    const sim = new BlackHoleSim({ lifetime: 90, emitRate: 40, seed: 5 });
    sim.addDustRing(100);
    let n = 0;
    while (!sim.evaporated && n++ < 10000) sim.step(dt);
    assert.ok(sim.evaporated, `dt=${dt} never evaporated`);
    assert.ok(Number.isFinite(sim.t) && Number.isFinite(sim.emitAcc), `dt=${dt} produced non-finite state`);
    assert.ok(sim.photons.every(q => Number.isFinite(q.x) && Number.isFinite(q.y)));
  }
});

test('regression: many lifetimes and seeds all terminate', () => {
  for (const lifetime of [15, 37, 90, 240]) {
    for (const seed of [1, 2, 3]) {
      const sim = new BlackHoleSim({ lifetime, emitRate: 40, seed });
      let n = 0;
      while (!sim.evaporated && n++ < 100000) sim.step(1 / 60);
      assert.ok(sim.evaporated, `lifetime=${lifetime} seed=${seed}`);
    }
  }
});
