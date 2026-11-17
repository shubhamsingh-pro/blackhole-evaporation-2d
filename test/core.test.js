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

// ---- Information layer (Susskind 1994 / Page 1993) ----------------------------------

const MSG = Array.from({ length: 36 }, (_, i) => (i * 7 + 3) % 5 < 2 ? 1 : 0);

test('horizon bit capacity follows the area law S = A/4G (bits ~ m^2)', () => {
  const sim = new BlackHoleSim({ lifetime: 60, emitRate: 0, bitsAtStart: 160 });
  assert.equal(sim.bitsCapacity, 160);
  for (let i = 0; i < 30 * 60; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.bitsCapacity - 160 * sim.m * sim.m) < 1e-9);
  assert.ok(sim.bitsCapacity < 160);
});

test('Page time: radiation entropy equals hole entropy at t = tau (1 - (4/7)^1.5)', () => {
  const sim = new BlackHoleSim({ lifetime: 90, emitRate: 0 });
  const m = sim.massAt(sim.pageTime);
  sim.m = m; // evaluate the entropy formulas at the analytic Page-time mass
  assert.ok(Math.abs(sim.hawkingRadEntropy - sim.bitsCapacity) < 1e-9);
  assert.ok(Math.abs(sim.pageTime / 90 - 0.5681) < 1e-3);
});

test('Page curve is the Hawking curve before the Page time and the hole entropy after', () => {
  const sim = new BlackHoleSim({ lifetime: 90, emitRate: 0 });
  sim.m = sim.massAt(0.3 * 90);
  assert.equal(sim.pageEntropy, sim.hawkingRadEntropy);
  sim.m = sim.massAt(0.8 * 90);
  assert.equal(sim.pageEntropy, sim.bitsCapacity);
  // Hawking's curve ends above the entropy the hole started with: the "information loss"
  sim.m = 0;
  assert.ok(sim.hawkingRadEntropy > sim.N0);
  assert.equal(sim.pageEntropy, 0);
});

test('message covers the horizon after t_h ln N, eq. (4.10), and not before', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 0 }); // static mass
  sim.sendMessage(MSG);
  const expected = sim.horizonTimeScale * Math.log(sim.bitsCapacity); // 4MG ln(N)
  let t = 0;
  while (sim.messageSpread < 1 && t < 60) { sim.step(1 / 120); t += 1 / 120; }
  assert.ok(Math.abs(t - expected) / expected < 0.02, `covered at ${t}, expected ${expected}`);
  assert.ok(t < sim.lifetime * 1e-6, 'far shorter than the evaporation time');
});

test('spreading is exponential in time (eq. 4.15: R_perp^2 ~ exp(t/4MG))', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 0 });
  sim.sendMessage(MSG);
  const f0 = sim.messageFront;
  sim.step(1);
  const f1 = sim.messageFront;
  sim.step(1);
  const f2 = sim.messageFront;
  assert.ok(Math.abs(f1 / f0 - f2 / f1) < 1e-6, 'constant growth factor per second');
  const expectedFactor = Math.exp(1 / (2 * sim.horizonTimeScale));
  assert.ok(Math.abs(f1 / f0 - expectedFactor) < 1e-6);
});

test('holographic mode: nothing leaves before the Page time, everything by the end', () => {
  const sim = new BlackHoleSim({ lifetime: 90, emitRate: 0, seed: 3, infoMode: 'holographic' });
  sim.sendMessage(MSG);
  let early = 0, last = 0, beforeBurst = 0;
  const carriersSeen = new Set();
  while (!sim.evaporated && sim.t < 200) {
    sim.step(1 / 60);
    for (const q of sim.photons) if (q.info) carriersSeen.add(q.idx);
    if (sim.t < sim.pageTime) early = Math.max(early, sim.message.recovered);
    assert.ok(sim.message.recovered >= last, 'recovery never goes backwards');
    last = sim.message.recovered;
    if (!sim.evaporated) beforeBurst = sim.message.recovered;
  }
  assert.equal(beforeBurst, MSG.length, 'the Page-curve rule releases everything before the final burst');
  assert.equal(early, 0, 'no information before the Page time');
  assert.ok(sim.evaporated);
  assert.equal(sim.message.recovered, MSG.length);
  assert.equal(sim.messageOnHorizon().length, 0);
  for (const q of sim.photons) if (q.info) carriersSeen.add(q.idx);
  assert.ok(carriersSeen.size > 0, 'information leaves as tagged quanta');
});

test('holographic mode: the recovered bits are the bits that were sent', () => {
  const sim = new BlackHoleSim({ lifetime: 40, emitRate: 0, seed: 9 });
  sim.sendMessage(MSG);
  const seen = new Map();
  while (!sim.evaporated) {
    sim.step(1 / 60);
    for (const q of sim.photons) if (q.info) seen.set(q.idx, q.bit);
  }
  for (let j = 0; j < MSG.length; j++) assert.equal(seen.get(j), MSG[j], `bit ${j}`);
});

test('hawking mode: no information ever returns and the message is destroyed', () => {
  const sim = new BlackHoleSim({ lifetime: 40, emitRate: 0, seed: 3, infoMode: 'hawking' });
  sim.sendMessage(MSG);
  let prev = MSG.length;
  while (!sim.evaporated && sim.t < 100) {
    sim.step(1 / 60);
    const n = sim.messageOnHorizon().length;
    assert.ok(n <= prev, 'bits only disappear');
    prev = n;
  }
  assert.equal(sim.message.recovered, 0);
  assert.equal(sim.photons.filter(q => q.info).length, 0);
  assert.equal(sim.messageOnHorizon().length, 0);
});

test('a message thrown in after the Page time comes out about one scrambling time later', () => {
  const sim = new BlackHoleSim({ lifetime: 90, emitRate: 0, seed: 4 });
  while (sim.t < 0.8 * 90) sim.step(1 / 60);
  sim.sendMessage(MSG);
  const tSend = sim.t;
  const tScr = sim.scramblingTime;
  while (sim.message.recovered < MSG.length && !sim.evaporated) sim.step(1 / 60);
  const dt = sim.t - tSend;
  assert.ok(!sim.evaporated, 'recovered before the final burst');
  assert.ok(dt > 0.5 * tScr && dt < 2 * tScr, `took ${dt}s, scrambling time ${tScr}s`);
});

test('information layer does not disturb the dust/photon random streams', () => {
  const run = (send) => {
    const s = new BlackHoleSim({ seed: 42 });
    s.addDustRing(40);
    if (send) s.sendMessage(MSG);
    for (let i = 0; i < 300; i++) s.step(1 / 60);
    return JSON.stringify(s.dust.slice(0, 5));
  };
  assert.equal(run(false), run(true));
});

// ---- 3D ----------------------------------------------------------------------------

const norm3 = (a, b, c) => Math.hypot(a, b, c);

test('2D mode keeps every particle exactly in the plane z = 0', () => {
  const sim = new BlackHoleSim({ lifetime: 30, emitRate: 40, seed: 2, dim: 2 });
  sim.addDustRing(100);
  for (let i = 0; i < 20 * 60; i++) sim.step(1 / 60);
  assert.ok(sim.dust.every(p => p.z === 0 && p.vz === 0));
  assert.ok(sim.photons.every(q => q.z === 0 && q.vz === 0));
});

test('3D: a tilted circular orbit stays circular and keeps its orbital plane', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 0, dim: 3 });
  const r0 = 9, v = sim.circularSpeed(r0), t = 0.7;
  sim.dust.push({ x: r0, y: 0, z: 0, vx: 0, vy: v * Math.cos(t), vz: v * Math.sin(t) });
  const L0 = (() => { const p = sim.dust[0]; return [p.y * p.vz - p.z * p.vy, p.z * p.vx - p.x * p.vz, p.x * p.vy - p.y * p.vx]; })();
  let rmin = Infinity, rmax = 0, worstLdir = 0;
  for (let i = 0; i < 60 * 120; i++) {
    sim.step(1 / 120);
    const p = sim.dust[0];
    const r = norm3(p.x, p.y, p.z);
    rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
    const L = [p.y * p.vz - p.z * p.vy, p.z * p.vx - p.x * p.vz, p.x * p.vy - p.y * p.vx];
    const cosang = (L[0] * L0[0] + L[1] * L0[1] + L[2] * L0[2]) / (norm3(...L) * norm3(...L0));
    worstLdir = Math.max(worstLdir, 1 - cosang);
  }
  assert.ok(rmax - rmin < 0.02 * r0, `radius drifted ${rmin}..${rmax}`);
  assert.ok(worstLdir < 1e-9, `orbital plane wobbled: ${worstLdir}`);
});

test('3D: Hawking quanta are emitted over the whole sphere at speed c', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 400, seed: 11, dim: 3, killRadius: 1e9 });
  sim.step(2);
  const n = sim.photons.length;
  assert.ok(n > 500, `only ${n} quanta`);
  let sumCos = 0, steep = 0;
  for (const q of sim.photons) {
    const r = norm3(q.x, q.y, q.z);
    assert.ok(r > sim.rs, 'outside horizon');
    assert.ok(Math.abs(norm3(q.vx, q.vy, q.vz) - sim.c) < 1e-9, 'speed c');
    sumCos += q.z / r;
    if (Math.abs(q.z / r) > 0.5) steep++;
  }
  assert.ok(Math.abs(sumCos / n) < 0.1, `net up/down bias ${sumCos / n}`);
  assert.ok(Math.abs(steep / n - 0.5) < 0.08, `fraction within 60 degrees of the axis: ${steep / n}`);
});

test('3D: dust ring becomes a thick disc but keeps radii and speeds', () => {
  const flat = new BlackHoleSim({ seed: 5, dim: 2 }); flat.addDustRing(300, 7, 12);
  const disc = new BlackHoleSim({ seed: 5, dim: 3 }); disc.addDustRing(300, 7, 12);
  const zmax = Math.max(...disc.dust.map(p => Math.abs(p.z)));
  assert.ok(zmax > 1.5, `disc too thin: ${zmax}`);
  for (let i = 0; i < 300; i++) {
    const a = flat.dust[i], b = disc.dust[i];
    assert.ok(Math.abs(norm3(a.x, a.y, a.z) - norm3(b.x, b.y, b.z)) < 1e-9, 'radius kept');
    assert.ok(Math.abs(norm3(a.vx, a.vy, a.vz) - norm3(b.vx, b.vy, b.vz)) < 1e-9, 'speed kept');
  }
});

test('setDim flattens and re-inflates a running simulation without changing the mass law', () => {
  const sim = new BlackHoleSim({ lifetime: 60, emitRate: 40, seed: 8, dim: 3 });
  sim.addDustRing(120);
  for (let i = 0; i < 6 * 60; i++) sim.step(1 / 60);
  assert.ok(sim.photons.some(q => Math.abs(q.z) > 0.5), 'some quanta are off the plane in 3D');
  sim.setDim(2);
  assert.ok(sim.dust.every(p => p.z === 0 && p.vz === 0));
  assert.ok(sim.photons.every(q => q.z === 0 && q.vz === 0));
  assert.ok(sim.photons.every(q => Math.abs(norm3(q.vx, q.vy, q.vz) - sim.c) < 1e-6), 'photon speed preserved');
  for (let i = 0; i < 3 * 60; i++) sim.step(1 / 60);
  assert.ok(sim.photons.every(q => q.z === 0), 'stays planar in 2D');
  const before = sim.dust.map(p => [norm3(p.x, p.y, p.z), norm3(p.vx, p.vy, p.vz)]);
  sim.setDim(3);
  sim.dust.forEach((p, i) => {
    assert.ok(Math.abs(norm3(p.x, p.y, p.z) - before[i][0]) < 1e-9);
    assert.ok(Math.abs(norm3(p.vx, p.vy, p.vz) - before[i][1]) < 1e-9);
  });
  assert.ok(sim.dust.some(p => Math.abs(p.z) > 0.3), 'dust spread out of the plane');
  assert.ok(Math.abs(sim.m - sim.massAt(sim.t)) < 1e-6, 'mass law unaffected by the dimension');
});

test('3D: dust above the pole is swallowed too', () => {
  const sim = new BlackHoleSim({ lifetime: 1e9, emitRate: 0, dim: 3 });
  sim.dust.push({ x: 0, y: 0, z: 2.1, vx: 0, vy: 0, vz: 0 });
  sim.step(0.5);
  assert.equal(sim.dust.length, 0);
  assert.equal(sim.swallowed, 1);
});

test('3D: full default run terminates with an isotropic burst and the message returns', () => {
  const sim = new BlackHoleSim({ lifetime: 90, emitRate: 40, seed: 5, dim: 3, infoMode: 'holographic' });
  sim.addDustRing(150);
  sim.sendMessage(MSG);
  let n = 0;
  while (!sim.evaporated && n++ < 20000) sim.step(1 / 60);
  assert.ok(sim.evaporated);
  assert.equal(sim.message.recovered, MSG.length);
  const burst = sim.photons.filter(q => q.T >= 25 && !q.info);
  assert.ok(burst.length >= 800);
  assert.ok(burst.some(q => q.vz > 1) && burst.some(q => q.vz < -1), 'burst goes both up and down');
  assert.ok(Number.isFinite(sim.t));
});
