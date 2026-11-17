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
      this.maxPhotons = opts.maxPhotons ?? 2500; // 3D: bursts push this up temporarily
      this.killRadius = opts.killRadius ?? 45;
      this.rand = mulberry32(opts.seed ?? 1);
      // Information layer (see "Information" section below). A separate RNG keeps the
      // dust/photon streams identical whether or not a message is sent.
      this.N0 = opts.bitsAtStart ?? 160; // horizon bits at m = 1 (S = A/4G in bits)
      this.infoMode = opts.infoMode ?? 'holographic'; // or 'hawking' (information is destroyed)
      this.infoRand = mulberry32((opts.seed ?? 1) + 977);
      // 2 = everything stays in the plane z = 0 (the original toy); 3 = full 3D. The 3D-only
      // random draws use their own generator so the 2D stream is untouched.
      this.dim = opts.dim ?? 2;
      this.rand3 = mulberry32((opts.seed ?? 1) + 4242);
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
      this.message = null;
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
        const p = {
          x: r * Math.cos(th),
          y: r * Math.sin(th),
          z: 0,
          vx: -Math.sin(th) * vc * f * dir,
          vy: Math.cos(th) * vc * f * dir,
          vz: 0,
        };
        if (this.dim === 3) this._tilt(p, 0.6); // a puffy disc instead of a flat one
        this.dust.push(p);
      }
    }

    // Uniformly random unit vector (3D).
    _unit3() {
      const R = this.rand3;
      const z = 2 * R() - 1, ph = 2 * Math.PI * R(), q = Math.sqrt(1 - z * z);
      return [q * Math.cos(ph), q * Math.sin(ph), z];
    }

    // Rotate a particle's position and velocity together about a random axis lying in the
    // equatorial plane. A central force is rotation-symmetric, so the orbit stays a valid
    // orbit with the same radius and speed, just in a tilted plane.
    _tilt(p, maxTilt) {
      const R = this.rand3;
      const al = R() * 2 * Math.PI, t = (2 * R() - 1) * maxTilt;
      const kx = Math.cos(al), ky = Math.sin(al); // kz = 0
      const c = Math.cos(t), sn = Math.sin(t);
      const rot = (x, y, z) => {
        const kd = kx * x + ky * y;                       // k . v
        const cx = ky * z, cy = -kx * z, cz = kx * y - ky * x; // k x v
        return [x * c + cx * sn + kx * kd * (1 - c),
                y * c + cy * sn + ky * kd * (1 - c),
                z * c + cz * sn];
      };
      [p.x, p.y, p.z] = rot(p.x, p.y, p.z || 0);
      [p.vx, p.vy, p.vz] = rot(p.vx, p.vy, p.vz || 0);
    }

    // Switch between the 2D toy and full 3D while the simulation runs.
    setDim(d) {
      if (d === this.dim) return;
      this.dim = d;
      if (d === 2) {
        for (const p of this.dust) { p.z = 0; p.vz = 0; }
        for (const q of this.photons) {
          const sp = Math.hypot(q.vx, q.vy, q.vz || 0), hz = Math.hypot(q.vx, q.vy);
          if (hz > 1e-9) { q.vx *= sp / hz; q.vy *= sp / hz; }
          q.z = 0; q.vz = 0;
        }
        for (const g of this.ghosts) { g.z = 0; g.vz = 0; }
      } else {
        for (const p of this.dust) this._tilt(p, 0.6);
      }
    }

    // ---- Information (Susskind, "The World as a Hologram", 1994; 't Hooft; Page 1993) -----
    // This layer is bookkeeping for the *proposed* resolution of the information paradox,
    // not a derivation of it. It assumes the proposal: the horizon stores at most one bit per
    // Planck area, infalling information spreads over the stretched horizon at the causal
    // limit, and the outside description is unitary.

    // Eq. (1.3): S = A/4G = (A/lp^2) ln 2, i.e. one bit per Planck area. In our units the
    // area scales like m^2, and the hole starts with N0 bits.
    get bitsCapacity() { const r = this.m / this.m0; return this.N0 * r * r; }

    // Hawking's (information-losing) radiation entropy: the radiation is exactly thermal, so
    // its entropy only grows. A 4D blackbody emits 4/3 of the entropy the hole loses.
    get hawkingRadEntropy() { const r = this.m / this.m0; return Math.max(0, (4 / 3) * this.N0 * (1 - r * r)); }

    // Page (1993), the paper's ref. [20]: for a unitary process the radiation entropy cannot
    // exceed what the hole can still hold, so it turns over at the Page time.
    get pageEntropy() { return Math.min(this.hawkingRadEntropy, this.bitsCapacity); }

    // Radiation entropy equals hole entropy when (4/3)(1-m^2) = m^2, i.e. m^2 = 4/7 m0^2.
    get pageTime() { return this.lifetime * (1 - Math.pow(4 / 7, 1.5)); }

    // Eq. (4.4)/(4.5): a Schwarzschild time translation is a boost with rapidity t/4MG.
    // With GM = c^2 m this is t_h = 4GM/c^3 = 4m/c.
    get horizonTimeScale() { return 4 * this.m / this.c; }

    // Eq. (4.10): t_spread = 4MG ln(M^2 G^2), with M^2G^2 ~ number of bits.
    get scramblingTime() { return this.horizonTimeScale * Math.log(Math.max(this.bitsCapacity, 2)); }

    // The three entropy curves at time t, for plotting: hole capacity, Hawking's radiation
    // entropy (information lost) and Page's curve (information preserved).
    entropiesAt(t) {
      const r = this.massAt(t) / this.m0;
      const cap = this.N0 * r * r;
      const rad = (4 / 3) * this.N0 * (1 - r * r);
      return { cap, rad, page: Math.min(cap, rad) };
    }

    // Send a message (array of 0/1 bits) into the hole.
    sendMessage(bits) {
      if (this.evaporated || this.message || !bits.length) return false;
      const k = bits.length, R = this.infoRand;
      const N = this.bitsCapacity;
      const order = Array.from({ length: k }, (_, i) => i); // order bits leave / are destroyed
      for (let i = k - 1; i > 0; i--) {
        const j = Math.floor(R() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      this.message = {
        bits: bits.slice(), k, tSent: this.t, mSent: this.m, nSent: N,
        theta0: R() * 2 * Math.PI,                              // where it hit the horizon
        scr: Array.from({ length: k }, () => R() * 2 * Math.PI), // where scrambling puts each bit
        order,
        // Eq. (4.15): the affected region on the stretched horizon grows as R_perp^2 ~ exp(t/4MG).
        // Starting at one "pixel" (angular half-width pi/sqrt(N)), it covers the ring after
        // t_h ln N, which is eq. (4.10).
        phi0: Math.PI / Math.sqrt(N), expo: 0,
        recovered: 0, got: new Array(k).fill(false),
      };
      return true;
    }

    // Angular half-width of the disturbed region on the horizon (eq. 4.15), capped at pi.
    get messageFront() {
      const g = this.message;
      return g ? Math.min(Math.PI, g.phi0 * Math.exp(g.expo)) : 0;
    }
    // 0 = localised at the entry point, 1 = fully spread (scrambled) over the horizon.
    get messageSpread() { return this.message ? this.messageFront / Math.PI : 0; }

    // Where bit j is drawn on the horizon ring right now.
    messageBitAngle(j) {
      const g = this.message;
      const loc = g.theta0 + (j - (g.k - 1) / 2) * (2 * Math.PI / g.nSent);
      const d = ((g.scr[j] - loc + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; // shortest way round
      return loc + this.messageSpread * d;
    }

    // Indices of message bits that are still stored on the horizon.
    messageOnHorizon() {
      const g = this.message;
      if (!g) return [];
      const all = g.bits.map((_, j) => j);
      if (this.infoMode === 'holographic') return all.filter(j => !g.got[j]);
      if (this.evaporated) return [];
      // Hawking mode: bits are destroyed together with the horizon pixels that hold them.
      const r = this.m / g.mSent;
      const survive = Math.max(0, Math.min(g.k, Math.round(g.k * r * r)));
      const removed = new Set(g.order.slice(0, g.k - survive));
      return all.filter(j => !removed.has(j));
    }

    // Holographic mode: a message bit leaves in the radiation once the radiation entropy
    // exceeds the hole's by enough (Page), and only after the message has been scrambled.
    _updateMessage() {
      const g = this.message;
      if (!g || this.infoMode !== 'holographic') return;
      let target = g.recovered;
      if (this.evaporated) {
        target = g.k; // whatever is left comes out in the final burst: nothing is lost
      } else if (this.messageSpread >= 1) {
        const frac = (this.hawkingRadEntropy - this.bitsCapacity) / g.k;
        target = Math.max(target, Math.floor(Math.min(1, Math.max(0, frac)) * g.k + 1e-9));
      }
      while (g.recovered < target) {
        const j = g.order[g.recovered];
        g.got[j] = true;
        g.recovered++;
        this._spawnInfoPhoton(j);
      }
    }

    _spawnInfoPhoton(j) {
      const th = this.messageBitAngle(j);
      const r = Math.max(this.rs * 1.04, 0.2);
      const ang = th + (this.infoRand() - 0.5) * 0.5;
      this.photons.push({
        x: r * Math.cos(th), y: r * Math.sin(th), z: 0,
        vx: this.c * Math.cos(ang), vy: this.c * Math.sin(ang), vz: 0,
        T: this.evaporated ? 30 : this.temperature, age: 0,
        info: true, bit: this.message.bits[j], idx: j,
      });
    }

    // Radial factor k such that a = k * (x, y, z).  PW potential: a = -GM / (r - rs)^2.
    _gk(r) {
      if (this.evaporated) return 0;
      const d = Math.max(r - this.rs, 0.05);
      return -this.gm / (d * d * r);
    }

    accel(x, y, z = 0) {
      const k = this._gk(Math.hypot(x, y, z));
      return [k * x, k * y, k * z];
    }

    _stepDust(h) {
      const keep = [];
      for (const p of this.dust) {
        if (p.z === undefined) { p.z = 0; p.vz = 0; }
        // velocity Verlet (symplectic -> orbits stay stable over many periods)
        let k = this._gk(Math.hypot(p.x, p.y, p.z));
        p.vx += 0.5 * h * k * p.x; p.vy += 0.5 * h * k * p.y; p.vz += 0.5 * h * k * p.z;
        p.x += h * p.vx; p.y += h * p.vy; p.z += h * p.vz;
        const r = Math.hypot(p.x, p.y, p.z);
        k = this._gk(r);
        p.vx += 0.5 * h * k * p.x; p.vy += 0.5 * h * k * p.y; p.vz += 0.5 * h * k * p.z;

        if (!this.evaporated && r <= this.rs * 1.08) {
          this.swallowed++;
          if (this.accrete) this.m += this.dustMass;
        } else if (r < this.killRadius * 4) {
          keep.push(p);
        }
      }
      this.dust = keep;
    }

    _emitPair3(T) {
      const R = this.rand3;
      const u = this._unit3();
      const r = this.rs * (1.02 + 0.06 * R());
      // direction a little off radial, like the 2D case: rotate u towards a random perpendicular
      const w = this._unit3();
      const wu = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
      let px = w[0] - wu * u[0], py = w[1] - wu * u[1], pz = w[2] - wu * u[2];
      const pn = Math.hypot(px, py, pz) || 1;
      px /= pn; py /= pn; pz /= pn;
      const tilt = (R() - 0.5) * 1.1, ct = Math.cos(tilt), st = Math.sin(tilt);
      this.photons.push({
        x: r * u[0], y: r * u[1], z: r * u[2],
        vx: this.c * (u[0] * ct + px * st), vy: this.c * (u[1] * ct + py * st), vz: this.c * (u[2] * ct + pz * st),
        T, age: 0,
      });
      const ri = this.rs * 0.95;
      this.ghosts.push({
        x: ri * u[0], y: ri * u[1], z: ri * u[2],
        vx: -this.c * 0.5 * u[0], vy: -this.c * 0.5 * u[1], vz: -this.c * 0.5 * u[2],
        life: 0.35, age: 0,
      });
    }

    _emitPair(T) {
      if (this.photons.length >= this.maxPhotons) return;
      if (this.dim === 3) { this._emitPair3(T); return; }
      const th = this.rand() * Math.PI * 2;
      const r = this.rs * (1.02 + 0.06 * this.rand());
      const spread = (this.rand() - 0.5) * 1.1; // radians off radial
      const ang = th + spread;
      this.photons.push({
        x: r * Math.cos(th), y: r * Math.sin(th), z: 0,
        vx: this.c * Math.cos(ang), vy: this.c * Math.sin(ang), vz: 0,
        T, age: 0,
      });
      // The negative-energy partner: shown briefly falling into the hole.
      const ri = this.rs * 0.95;
      this.ghosts.push({
        x: ri * Math.cos(th), y: ri * Math.sin(th), z: 0,
        vx: -this.c * 0.5 * Math.cos(th), vy: -this.c * 0.5 * Math.sin(th), vz: 0,
        life: 0.35, age: 0,
      });
    }

    _burst() {
      // Final stage: remaining mass goes out in a flash of very hot quanta.
      this.evaporated = true;
      this.burstTime = this.t;
      this.m = 0;
      for (let i = 0; i < (this.dim === 3 ? 900 : 500); i++) {
        const th = this.rand() * Math.PI * 2;
        const sp = this.c * (0.55 + 0.45 * this.rand());
        const T = 25 + 15 * this.rand();
        if (this.dim === 3) {
          const u = this._unit3();
          this.photons.push({ x: 0, y: 0, z: 0, vx: sp * u[0], vy: sp * u[1], vz: sp * u[2], T, age: 0 });
        } else {
          this.photons.push({ x: 0, y: 0, z: 0, vx: sp * Math.cos(th), vy: sp * Math.sin(th), vz: 0, T, age: 0 });
        }
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

          if (this.message) this.message.expo += h / (2 * this.horizonTimeScale);

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
        for (const q of this.photons) { q.x += q.vx * h; q.y += q.vy * h; q.z += q.vz * h; q.age += h; }
        for (const g of this.ghosts) { g.x += g.vx * h; g.y += g.vy * h; g.z += g.vz * h; g.age += h; }
        this.t += h;
      }
      this._updateMessage();
      this.photons = this.photons.filter(q => Math.hypot(q.x, q.y, q.z) < this.killRadius);
      this.ghosts = this.ghosts.filter(g => g.age < g.life);
      const last = this.history[this.history.length - 1];
      if (this.t - last.t >= 0.25 || (this.evaporated && last.m !== 0)) {
        this.history.push({ t: this.t, m: this.m });
      }
    }
  }

  return { BlackHoleSim, mulberry32 };
});
