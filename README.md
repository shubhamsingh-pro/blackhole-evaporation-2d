# 2D Black Hole Evaporation

An interactive toy simulation of a black hole evaporating through Hawking radiation. It runs in
the browser with no build step and no dependencies.

A black hole sits in the middle of a ring of orbiting dust. As it radiates, it

- **shrinks** (the horizon radius falls),
- **heats up** (emitted quanta shift from red toward blue-white),
- **radiates faster and faster**, and
- ends in a final burst, after which gravity disappears and the dust flies off in straight lines.

## Run it

```bash
npm run serve          # or: python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` in a browser. Useful URL parameters:

| Parameter | Effect |
|-----------|--------|
| `?t=60`   | start 60 simulated seconds into the run |
| `?life=120` | evaporation time τ in seconds (15–240) |

The right-hand column lists every equation the simulation uses with its live value, and checks the
simulated mass against the exact solution `m(t) = (m₀³ − 3at)^(1/3)` (the difference should stay
below 1e-6; it is shown as n/a after the final burst, or when dust accretion is on).

Controls: **Space** pauses, **R** restarts. The sidebar sets the evaporation time τ and playback
speed, toggles whether swallowed dust feeds the hole, and shows the photon sphere (3M) and
innermost stable circular orbit (6M).

## The physics

Units are chosen so the initial mass is `m = 1` and the horizon radius is `r_s = 2m`.

| Ingredient | Rule used |
|------------|-----------|
| Horizon | `r_s = 2GM/c²` |
| Evaporation | `dm/dt = −a / m²`, solved exactly: `m(t) = (m₀³ − 3at)^(1/3)`. Lifetime `τ = m₀³ / 3a`. |
| Temperature | `T ∝ 1/m` |
| Power | `L ∝ 1/m²` |
| Quanta emitted per second | `L / ⟨E⟩ ∝ 1/m`, spawned just outside the horizon |
| Gravity on dust | Paczyński–Wiita potential, `a = −GM / (r − r_s)²` |
| Final stage | below `m = 0.04` the hole releases a burst of very hot quanta |

The Paczyński–Wiita potential is a pseudo-Newtonian trick. In a 2D plane it reproduces the
Schwarzschild horizon at `2GM/c²` and the ISCO at `6GM/c²`, which is what makes the orbits behave
sensibly near the hole without integrating full geodesics.

Because the hole loses mass, **orbits widen**: dust that was safely bound at the start drifts
outward and, near the end when the mass drops quickly, is flung away. The unit tests check that
effect, and also that orbits stay stable when the mass is held fixed.

Each emitted quantum is drawn with a dim "partner" falling into the hole. This is the common
pair-creation picture of Hawking radiation; it is a visual aid, and the mass loss itself comes
from the formula above, not from counting partners.

## What this is not

Be careful about reading too much into it:

- **Not a general-relativity solver.** Light does not bend around the hole; photons travel in
  straight lines at `c`. Gravity is pseudo-Newtonian.
- **Not a quantum field theory calculation.** There is no greybody factor, no angular-momentum
  dependence and no spectrum. Quanta are coloured by temperature only.
- **The timescale is made up.** A real black hole of one solar mass would take about 10⁶⁷ years
  to evaporate. Here you choose τ so that it takes about a minute.
- **The ending is a cartoon.** What actually happens in the last instant is unknown without a
  theory of quantum gravity.
- **It's 2D.** The Hawking scalings used are the 4D ones. A true 2D black hole (for example in
  CGHS dilaton gravity) has different formulas.

## Tests

```bash
npm test
```

Checks the evaporation law against the analytic solution, the lifetime, orbit stability,
swallowing, emission outside the horizon, the final burst, reproducibility with a fixed seed,
and regressions for a hang that occurred when the last timestep took the mass to exactly zero.

## Layout

```
index.html        page and controls
src/core.js       physics (no DOM; runs in browser and Node)
src/app.js        canvas rendering, HUD, controls
test/             Node tests (node:test, no dependencies)
```

## Ideas for next steps

- Bend light with a Schwarzschild null-geodesic integrator.
- Add the CGHS or JT-gravity 2D dilaton model for a genuinely 2D evaporation.
- Greybody-weighted emission spectrum and a spectrum plot.
- Charge or spin (Reissner–Nordström, Kerr equatorial plane).

## License

MIT
