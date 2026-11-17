# Black Hole Evaporation, 2D and 3D

An interactive toy simulation of a black hole evaporating through Hawking radiation, with a switch
between a flat 2D slice and a full 3D view. It runs in the browser with no build step and no
dependencies.

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
| `?mode=hawking` or `?mode=holographic` | which theory the information panel simulates |
| `?send=0` | send the message at t = 0 s (any time in seconds works) |
| `?dim=3` | start in 3D (add `&yaw=0.6&elev=0.5&dist=42&auto=0` to set the camera) |

The right-hand column lists every equation the simulation uses with its live value, and checks the
simulated mass against the exact solution `m(t) = (m₀³ − 3at)^(1/3)` (the difference should stay
below 1e-6; it is shown as n/a after the final burst, or when dust accretion is on).

Controls: **Space** pauses, **R** restarts, **2** / **3** switch between the 2D and 3D views. The sidebar sets the evaporation time τ and playback
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

## 2D and 3D

The **2D / 3D** switch at the top of the sidebar changes the physics and the camera together, while the
run keeps going.

- **2D** is the original flat slice: everything stays in the plane `z = 0`.
- **3D** runs the same laws in three dimensions. Gravity is the same central pseudo-Newtonian force, so a
  tilted orbit is just a rotated copy of a flat one; Hawking quanta are emitted uniformly over the whole
  horizon sphere and the final burst goes out in all directions; the dust ring becomes a thick disc of
  tilted orbits.
- **Camera.** Drag to orbit, scroll to zoom, **Reset view** to go back, **Auto-rotate** to let it spin. The
  renderer is a small perspective projection on a canvas (no WebGL, no dependencies): the horizon is a
  black sphere with a latitude/longitude grid, the photon sphere is drawn as three great circles, the
  ISCO as a ring, nearer particles are larger and brighter, and anything behind the hole is hidden.
  The 2D view is the same camera looking straight down, so the switch is a smooth camera move.
- Switching to 2D flattens the dust and the quanta into the plane (speeds of quanta are kept); switching to
  3D tilts the existing dust into a disc.

The mass law, temperature and power do not depend on the dimension. The information panel does read
differently: in 3D the horizon really is a sphere of area `4π r_s² ∝ m²`, so `S = A/4G` is literal, and the
pixel ring on the horizon screen is its equator. In 2D the ring stands in for the sphere.

## The information paradox (Susskind, "The World as a Hologram", 1994)

Hawking's calculation says the radiation is exactly thermal, so when a hole evaporates whatever
fell in is destroyed: a pure state turns into a mixed one. The panel under the main view lets you
throw a message (a 6×6 picture, 36 bits) into the hole and compare two answers using the radio
switch:

- **Hawking 1975, information destroyed.** The message's bits vanish along with the horizon pixels
  that hold them and nothing ever comes back. The radiation entropy rises forever and ends above
  what the hole started with.
- **Holographic, information preserved (’t Hooft, Susskind).** The proposal of the paper.

What the simulation takes from the paper, and where:

| Paper | Used for |
|-------|----------|
| Eq. 1.3, `S = A/4G = (A/lp²) ln 2` | The horizon holds one bit per Planck area. Here bits `= N₀ m²` (N₀ = 160), drawn as the ring of pixels. |
| Eqs. 4.4, 4.15, `R⊥² = ρ₀² e^(t/4MG)` | The region of the horizon disturbed by the message (orange arc) grows exponentially, at the causal limit. In these units `4MG = 4m/c`. |
| Eq. 4.10, `t_spread = 4MG ln(M²G²)` | Once that region covers the ring, the message is scrambled. This is far shorter than the evaporation time. |
| §6 and Page (the paper's ref. 20) | After scrambling, a small arc of the horizon looks thermal and holds no information. The "Read an arc" slider shows this: with an arc of fraction f you learn nothing until f exceeds 1/2. |
| §7, unitary S-matrix | Formation plus evaporation is unitary. Using Page's counting, the radiation entropy `min(S_rad, S_BH)` turns over at the Page time `t = τ(1 − (4/7)^(3/2)) ≈ 0.57 τ`, and the message leaves in the radiation once `S_rad − S_BH` exceeds its size. Each cyan quantum in the main view carries one bit. |

Things to try: send the message at the start and watch it scatter over the ring in a few seconds, then
return after about 70% of the lifetime; send it after the Page time and it comes back about one
scrambling time later (Hayden–Preskill); switch to Hawking and see it destroyed.

**Be careful about the claims.** The paper proposes this picture; it does not prove it, and it
concedes in §7 that an outside S-matrix description cannot say what a freely falling observer sees.
This simulation is bookkeeping *assuming* the proposal. It does not derive unitarity, and the
numbers (160 bits, a 4/3 entropy ratio, Page's counting for a random state) are a toy version of the
real thing. The entropy curves assume dust accretion is off.

## The Penrose diagram

Below the main view there is a live Penrose (causal) diagram of the same run. Light travels at 45 degrees, time goes up, the left edge is r = 0. It shows the collapsing shell, the singularity (spacelike), the event horizon (the "last ray"), the shrinking apparent horizon, the stretched horizon from the paper, the Hawking pairs (outgoing quanta coloured by temperature, partners falling in), the Page time, and a "now" slice that moves with the simulation. Your message is drawn too: in Hawking mode it ends on the singularity, in holographic mode it stays on the stretched horizon and returns in the radiation after the Page time.

It is a schematic: the geometry obeys the rules (null rays at 45 degrees, spacelike singularity, timelike apparent horizon, all checked in `test/penrose.test.js`) but distances are not to scale, and the evaporation point P is a cartoon of the traditional picture.

## What this is not

Be careful about reading too much into it:

- **Not a general-relativity solver.** Light does not bend around the hole; photons travel in
  straight lines at `c`. Gravity is pseudo-Newtonian. The 3D mode has no spin, so the disc does not
  precess or warp, and there is no lensing of the background.
- **Not a quantum field theory calculation.** There is no greybody factor, no angular-momentum
  dependence and no spectrum. Quanta are coloured by temperature only.
- **The timescale is made up.** A real black hole of one solar mass would take about 10⁶⁷ years
  to evaporate. Here you choose τ so that it takes about a minute.
- **The ending is a cartoon.** What actually happens in the last instant is unknown without a
  theory of quantum gravity.
- **The 2D mode is a slice, not a true 2D universe.** The Hawking scalings used are the 4D ones. A true
  2D black hole (for example in CGHS dilaton gravity) has different formulas.

## Tests

```bash
npm test
```

Checks the evaporation law against the analytic solution, the lifetime, orbit stability,
swallowing, emission outside the horizon, the final burst, reproducibility with a fixed seed,
the information layer (area-law bit count, the Page time, spreading time `4MG ln N`, nothing returning before the Page time in the holographic case, everything destroyed in the Hawking case, recovered bits matching what was sent), 3D physics (tilted orbits keep their plane, emission is uniform
over the sphere, `setDim` preserves radii and speeds, a full 3D run recovers the message), and regressions for a hang that occurred when the last timestep took the mass to exactly zero.

## Layout

```
index.html        page and controls
src/core.js       physics, 2D and 3D (no DOM; runs in browser and Node)
src/app.js        canvas rendering (2D view, 3D camera and renderer), HUD, controls
src/penrose.js    Penrose diagram geometry (pure, tested) and its drawing
test/             Node tests (node:test, no dependencies)
```

## Ideas for next steps

- Bend light with a Schwarzschild null-geodesic integrator.
- Add the CGHS or JT-gravity 2D dilaton model for a genuinely 2D evaporation.
- Greybody-weighted emission spectrum and a spectrum plot.
- Charge or spin (Reissner–Nordström, Kerr equatorial plane).

## License

MIT
