const test = require('node:test');
const assert = require('node:assert/strict');
const Pen = require('../src/penrose.js');
const { G } = Pen;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const S = Array.from({ length: 101 }, (_, i) => i / 100);

test('boundary points lie on the null boundaries I- (y = x - 1) and I+ (y = 1 - x)', () => {
  assert.ok(close(G.iMinus[1], G.iMinus[0] - 1));
  assert.ok(close(G.iZero[1], G.iZero[0] - 1) && close(G.iZero[1], 1 - G.iZero[0]));
  assert.ok(close(G.shellFoot[1], G.shellFoot[0] - 1), 'shell starts on I-');
  assert.ok(close(G.iPlus[1], 1 - G.iPlus[0]));
  assert.ok(close(G.uEH[1], 1 - G.uEH[0]), 'the last ray ends on I+');
});

test('the collapsing shell is an ingoing null ray from I- to the centre', () => {
  assert.equal(G.A[0], 0);
  assert.ok(close(G.A[1] - G.shellFoot[1], G.shellFoot[0] - G.A[0]), '45 degrees, up and to the left');
});

test('the event horizon is a single outgoing null ray through H and P to I+', () => {
  assert.ok(close(Pen.shellY(G.H[0]), G.H[1]), 'H is on the shell');
  assert.ok(close(G.P[1] - G.H[1], G.P[0] - G.H[0]), 'H to P at 45 degrees');
  assert.ok(close(G.uEH[1] - G.P[1], G.uEH[0] - G.P[0]), 'P to the end on I+ at 45 degrees');
});

test('the singularity is spacelike and runs from the shell to the evaporation point', () => {
  assert.ok(Pen.SING_SLOPE > 0 && Pen.SING_SLOPE < 1, `slope ${Pen.SING_SLOPE}`);
  assert.ok(close(Pen.sing(G.A[0]), G.A[1]) && close(Pen.sing(G.P[0]), G.P[1]));
});

test('the apparent horizon is timelike everywhere, starts on the shell and ends at P', () => {
  for (const s of S) {
    const [dx, dy] = Pen.ahTangent(s);
    assert.ok(Math.abs(dy) > Math.abs(dx), `not timelike at s=${s}: ${dx}, ${dy}`);
    assert.ok(dy > 0, 'it moves forward in time');
  }
  const a0 = Pen.ah(0), a1 = Pen.ah(1);
  assert.ok(close(Pen.shellY(a0[0]), a0[1]), 'forms on the shell');
  assert.ok(close(a1[0], G.P[0]) && close(a1[1], G.P[1]), 'ends at P');
});

test('the apparent horizon stays outside the event horizon until they meet at P', () => {
  for (const s of S) {
    const [x, y] = Pen.ah(s);
    assert.ok(y <= x + 1e-9, `inside the event horizon at s=${s}`); // outside = below the line y = x
  }
});

test('Hawking quanta land on I+ later (closer to i+) the later they are emitted; the last lands at the end of the last ray', () => {
  let prev = Infinity;
  for (const s of S) {
    const [lx, ly] = Pen.landing(Pen.ah(s));
    assert.ok(close(ly, 1 - lx), 'lands on I+');
    assert.ok(lx <= prev + 1e-12, 'monotonic along I+');
    prev = lx;
  }
  const end = Pen.landing(Pen.ah(1));
  assert.ok(close(end[0], G.uEH[0]) && close(end[1], G.uEH[1]));
});

test('a message thrown in at any time reaches the singularity, along the same ray as the partner mode', () => {
  assert.ok(close(Pen.origin(Pen.ah(0)), G.shellFoot[0]), 'earliest infall is the shell itself');
  for (const s of S) {
    const a = Pen.ah(s);
    const hit = Pen.infallHit(Pen.origin(a));
    assert.ok(hit, `no hit at s=${s}`);
    assert.ok(hit[0] >= -1e-9 && hit[0] <= G.P[0] + 1e-9);
    assert.ok(close(hit[1], Pen.sing(hit[0]), 1e-9), 'on the singularity');
    const part = Pen.partnerHit(a);
    assert.ok(close(part[0], hit[0], 1e-9) && close(part[1], hit[1], 1e-9), 'the partner mode falls along the same ingoing ray');
  }
  assert.ok(Pen.origin(Pen.ah(1)) <= 0.8 + 1e-9);
  assert.equal(Pen.infallHit(0.9), null, 'a message sent after the last ray misses the singularity');
});

test('the "now" slice is spacelike and ends on the singularity (or the regular centre)', () => {
  for (const s of S) {
    const a = Pen.ah(s);
    const outer = 1.5 * Math.abs((a[1] - G.iZero[1]) / (a[0] - G.iZero[0])); // steepest part of the smooth curve from i0
    assert.ok(outer < 1, `outer part not spacelike at s=${s}: ${outer}`);
    const b = Pen.sliceInner(a);
    assert.ok(close(b[0], 0, 0.003) || Math.abs(b[1] - Pen.sing(b[0])) < 0.005, `ends in the wrong place at s=${s}`);
    assert.ok(Math.abs((b[1] - a[1]) / (b[0] - a[0] || 1e-9)) <= 0.45 + 1e-6 || b[0] === a[0]);
  }
});

test('the Page time lies inside the evaporation', () => {
  const pageF = 1 - Math.pow(4 / 7, 1.5);
  assert.ok(pageF > 0.5 && pageF < 0.6);
  const p = Pen.ah(pageF);
  assert.ok(p[1] > Pen.ah(0)[1] && p[1] < G.P[1]);
});

// A recording stand-in for a canvas context: any method call is accepted.
function fakeCtx() {
  const calls = [];
  return new Proxy({ calls }, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { calls.push(k); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

test('draw() runs for every state without throwing', () => {
  const colorAt = (s, a) => `rgba(255,${Math.round(100 + 100 * s)},60,${a})`;
  const base = { pageF: 0.568, colorAt, mode: 'holographic', evaporated: false, message: null };
  const msg = (rec) => ({ fSent: 0.1, k: 36, recovered: rec.length, tRec: rec });
  const cases = [
    { ...base, f: 0 },
    { ...base, f: 0.5, message: msg([]) },
    { ...base, f: 0.8, message: msg([0.65, 0.7, 0.72]) },
    { ...base, f: 1, evaporated: true, message: msg(Array(36).fill(0.9)) },
    { ...base, mode: 'hawking', f: 0.7, message: msg([]) },
    { ...base, mode: 'hawking', f: 1, evaporated: true, message: msg([]) },
  ];
  for (const st of cases) {
    const ctx = fakeCtx();
    Pen.draw(ctx, 540, 880, st);
    assert.ok(ctx.calls.length > 50);
  }
});
