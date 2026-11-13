// Physics core for the 2D black hole evaporation toy model.
// No DOM access here, so it can run in Node (tests) and in the browser.
//
// Units: lengths in "world units", time in seconds of simulated time.
// The initial hole has mass m = 1 and Schwarzschild radius rs = 2.
// Gravity uses the Paczynski-Wiita pseudo-Newtonian potential, which
// reproduces the Schwarzschild horizon (r = 2GM/c^2) and ISCO (r = 6GM/c^2)
// in a 2D plane without needing full geodesic integration:
//     a(r) = -G M / (r - rs)^2,   with G M = c^2 * m   (so rs = 2 m)

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BHCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Small seedable RNG (mulberry32) so runs and tests are reproducible.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class BlackHoleSim {
    constructor(opts = {}) {
      this.c = opts.c ?? 6; // speed of light, world units / s
      this.lifetime = opts.lifetime ?? 90; // seconds until full evaporation
      this.mMin = opts.mMin ?? 0.04; // below this the hole "pops"
      this.accrete = opts.accrete ?? false; // do swallowed dust add mass?
      this.dustMass = opts.dustMass ?? 0.0004;
      this.emitRate = opts.emitRate ?? 30; // Hawking quanta per second at m = 1
      this.maxPhotons = opts.maxPhotons ?? 2500;
      this.killRadius = opts.killRadius ?? 45;
      this.rand = mulberry32(opts.seed ?? 1);
      this.reset();
    }

    reset() {
      this.m = 1;
      this.m0 = 1;
      this.t = 0;
      this.evaporated = false;
      this.burstTime = null;
      this.dust = [];
      this.photons = [];
      this.ghosts = [];
      this.emitAcc = 0;
      this.swallowed = 0;
      this.history = [{ t: 0, m: 1 }];
    }

    // dm/dt = -a / m^2  ->  m(t)^3 = m0^3 - 3 a t.   Lifetime = m0^3 / (3a).
    get a() { return (this.m0 ** 3) / (3 * this.lifetime); }
    get rs() { return 2 * this.m; }
    get gm() { return this.c * this.c * this.m; }
    get temperature() { return this.m > 0 ? 1 / this.m : Infinity; } // T ~ 1/M, relative to start
    get luminosity() { return this.m > 0 ? 1 / (this.m * this.m) : Infinity; } // L ~ 1/M^2
    get timeRemaining() { return this.evaporated ? 0 : (this.m ** 3) / (3 * this.a); }
    get photonSphere() { return 3 * this.m; }
    get isco() { return 6 * this.m; }

    // Analytic mass at time t after the start (for plotting / tests).
    massAt(t) {
      const v = this.m0 ** 3 - 3 * this.a * t;
      return v > 0 ? Math.cbrt(v) : 0;
    }

    circularSpeed(r) {
      // PW circular orbit: v^2 = GM r / (r - rs)^2
      return Math.sqrt(this.gm * r) / (r - this.rs);
    }

    // Ring of test particles on near-circular orbits, outside the ISCO.
    addDustRing(n = 300, rMin = 7, rMax = 12) {
      for (let i = 0; i < n; i++) {
        const r = rMin + (rMax - rMin) * this.rand();
        const th = this.rand() * Math.PI * 2;
        const vc = this.circularSpeed(r);
        const f = 0.9 + 0.1 * this.rand(); // mildly sub-circular -> slightly eccentric
        const dir = 1; // all prograde
        this.dust.push({
          x: r * Math.cos(th),
          y: r * Math.sin(th),
          vx: -Math.sin(th) * vc * f * dir,
          vy: Math.cos(th) * vc * f * dir,
        });
      }
    }

    accel(x, y) {
      if (this.evaporated) return [0, 0];
      const r = Math.hypot(x, y);
      const d = Math.max(r - this.rs, 0.05);
      const k = -this.gm / (d * d * r);
      return [k * x, k * y];
    }

    _stepDust(h) {
      const keep = [];
      for (const p of this.dust) {
        // velocity Verlet (symplectic -> orbits stay stable over many periods)
        let [ax, ay] = this.accel(p.x, p.y);
        p.vx += 0.5 * h * ax; p.vy += 0.5 * h * ay;
        p.x += h * p.vx; p.y += h * p.vy;
        [ax, ay] = this.accel(p.x, p.y);
        p.vx += 0.5 * h * ax; p.vy += 0.5 * h * ay;

        const r = Math.hypot(p.x, p.y);
        if (!this.evaporated && r <= this.rs * 1.08) {
          this.swallowed++;
          if (this.accrete) this.m += this.dustMass;
        } else if (r < this.killRadius * 4) {
          keep.push(p);
        }
      }
      this.dust = keep;
    }

    _emitPair(T) {
      if (this.photons.length >= this.maxPhotons) return;
      const th = this.rand() * Math.PI * 2;
      const r = this.rs * (1.02 + 0.06 * this.rand());
      const spread = (this.rand() - 0.5) * 1.1; // radians off radial
      const ang = th + spread;
      this.photons.push({
        x: r * Math.cos(th), y: r * Math.sin(th),
        vx: this.c * Math.cos(ang), vy: this.c * Math.sin(ang),
        T, age: 0,
      });
      // The negative-energy partner: shown briefly falling into the hole.
      const ri = this.rs * 0.95;
      this.ghosts.push({
        x: ri * Math.cos(th), y: ri * Math.sin(th),
        vx: -this.c * 0.5 * Math.cos(th), vy: -this.c * 0.5 * Math.sin(th),
        life: 0.35, age: 0,
      });
    }

    _burst() {
      // Final stage: remaining mass goes out in a flash of very hot quanta.
      this.evaporated = true;
      this.burstTime = this.t;
      this.m = 0;
      for (let i = 0; i < 500; i++) {
        const th = this.rand() * Math.PI * 2;
        const sp = this.c * (0.55 + 0.45 * this.rand());
        this.photons.push({
          x: 0, y: 0, vx: sp * Math.cos(th), vy: sp * Math.sin(th),
          T: 25 + 15 * this.rand(), age: 0,
        });
      }
      this.ghosts.length = 0;
    }

    // Advance by dt simulated seconds.
    step(dt) {
      if (dt <= 0) return;
      const nSub = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / nSub;
      for (let s = 0; s < nSub; s++) {
        if (!this.evaporated) {
          // exact solution of dm/dt = -a/m^2 over this substep
          const v = this.m ** 3 - 3 * this.a * h;
          this.m = v > 0 ? Math.cbrt(v) : 0;

          if (this.m <= this.mMin) {
            // Check first: a single substep can take m from just above mMin to exactly 0,
            // and the emission rate below divides by m.
            this._burst();
          } else {
            // Hawking quanta: rate ~ L / <E> ~ (1/m^2)/(1/m) = 1/m
            this.emitAcc += (this.emitRate / this.m) * h;
            let guard = 0;
            while (this.emitAcc >= 1 && guard++ < 50) {
              this.emitAcc -= 1;
              this._emitPair(this.temperature);
            }
            if (this.emitAcc > 1) this.emitAcc = 1; // drop backlog instead of spiralling
          }
        }
        this._stepDust(h);
        for (const q of this.photons) { q.x += q.vx * h; q.y += q.vy * h; q.age += h; }
        for (const g of this.ghosts) { g.x += g.vx * h; g.y += g.vy * h; g.age += h; }
        this.t += h;
      }
      this.photons = this.photons.filter(q => Math.hypot(q.x, q.y) < this.killRadius);
      this.ghosts = this.ghosts.filter(g => g.age < g.life);
      const last = this.history[this.history.length - 1];
      if (this.t - last.t >= 0.25 || (this.evaporated && last.m !== 0)) {
        this.history.push({ t: this.t, m: this.m });
      }
    }
  }

  return { BlackHoleSim, mulberry32 };
});
