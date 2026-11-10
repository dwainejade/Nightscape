# Nightscape app: progress

Goal: fly over the real USA (and anywhere else) in the R3F app in `app/`, under Nightscape's clouds, by
hand or on autopilot, by day and night, with real imagery, real elevation and city lights at night.

How we work:
- **Master session** coordinates. Each step below runs in **one child session at a time**, on its own
  branch in its own worktree. The master reviews it, asks the user, then merges into `main`.
- Each child session writes its plan at the top of its section and ticks boxes as it goes. **Edit only
  your own section here.**
- Nothing is pushed to GitHub without the user's OK.
- Data sources must be free and keyless. Ask the user before adding a new one, and keep attribution
  visible (Place tab + README).

Moved here from `volumetric-clouds` on 2026-11-09. That project is now reference only: its baked USA
map (`public/usa/`), city list (`public/usa/cities.json`, US Census, public domain) and notes can be
reused.

## Step 0: Master setup
- [x] Clone the fork to `Projects/Nightscape`; `app/` installs and builds
- [x] PROGRESS.md
- [x] User picks the first step and model: N1 on Sonnet (started 2026-11-09)

## Already in the app (before this plan)
- Nightscape clouds ported to R3F (WebGL 2), settings store and panel
- Real places: Terrarium elevation (AWS Open Data) + Sentinel-2 cloudless 2016 imagery (EOX, CC BY 4.0),
  ~150 km window, re-centred as you fly; OSM Nominatim search; map picker
- Day-night cycle, moon phase, manual flight (WASD), generated town lights

## Steps (in order)

### N1: Long-distance flight foundation
Make flights of thousands of km work over real places.
- [x] Plan written here (below)
- [x] Re-anchor the GeoRef (floating origin) when the camera gets far from it, with no visible jump in
      clouds, terrain or temporal history
- [x] Mercator scale changes with latitude: keep ground scale and vertical scale consistent on long
      north-south flights
- [x] Rolling windows load ahead in the direction of travel, with no hitches at speed
- [x] Cloud field doesn't visibly repeat on long flights (the 320-unit tile)
- [x] Coast-to-coast test: no seams, jumps or precision jitter (full NYC to LA run done in N2, see N2 result); build passes ✓

**N1 plan** (child session `n1-long-flight`):
1. *Re-anchor.* Shift the world by whole multiples of 1920 units when the camera is >1400 from 0. 1920 is a
   multiple of the terrain tile (640), the cloud tile (320) and the cloud sample-plane spacing (3.84), so
   neither baked textures nor cloud sampling move: only `gx0/gy0`, window origin, `uOrigin`, camera
   (auto path offset + manual `fly`), TAA previous camera shift. No rebake, no TAA reset.
2. *Mercator scale.* Keep exact Web Mercator at the place's zoom (conformal, continuous, so no pops).
   Vertical scale becomes a per-row function of latitude (`perMetre = exaggeration / metresPerUnit(lat)`,
   exaggeration fixed per flight, soft-compressed near the 34-unit relief ceiling), so relief stays
   proportionate from south to north. Ground scale is exposed (`groundMPerUnit`) for speed/HUD in N2.
3. *Load ahead.* Window swap is predicted from camera velocity and measured load time; the new window is
   centred ahead of travel. Tile fetches are de-duplicated and capped; window assembly is time-sliced.
4. *Cloud repetition.* Low-frequency noise of absolute Mercator position adds a coverage bias (and a mild
   warp) to the baked shape lookup, so each repeat of the 320 tile differs. No rebake needed.
5. *Dev helpers.* `__cloudScene.flyTo/teleport/setSpeed/perf/info`.

**N1 result** (branch `claude/n1-long-flight-308162`): re-anchor verified invisible (pixel diff at TAA noise floor);
fast flights NYC west at 40 u/s and Seattle south at 90 u/s: p99 frame 9.5 ms, 2-3 frames >25 ms per 4000
(the occasional ~40 ms frame at the end of a window bake is open). Horizontal scale stays Mercator
(about 1/cos(lat), so ground m/unit grows ~18% from Seattle to the Bay Area); only vertical scale and
`groundMPerUnit()` compensate. Dev helpers: `__cloudScene.{teleport,flyTo,flyRoute,setSpeed,info,perfStart,perfStop,setCloudVariety}`.

### N2: Autopilot between cities
- [x] Plan written here (below)
- [x] City list (`app/public/cities.json`, US Census, public domain; format = array of `{name, state, lon, lat, population}`, a world list can use the same keys with `state` = region/country)
- [x] Route: pick a destination, fly a smooth great-circle heading over real terrain, gentle banking and
      altitude changes, then the next city
- [x] Manual takeover with WASD/drag; R hands control back (keep the current behaviour)
- [x] Speed and time multiplier; HUD: nearest place, lat/lon, local time, destination
- [x] Build passes; a long autopilot run with no errors or ground clipping
- [x] Closes N1's coast-to-coast checkbox (NYC to LA run, results below)

**N2 plan** (child session `n2-autopilot`):
1. *Data.* `cities.json` fetched once at start (`geo/cities.ts`: load, great-circle distance/bearing, nearest, pick next). Credit in Place tab + README.
2. *Autopilot* (`engine.ts`, only when a real place is loaded; the sine path stays for the invented scene). It drives the
   existing free-fly camera state (`fly`) so manual takeover/handback share one pose and nothing can snap. Each frame:
   lat/lon of the camera -> initial great-circle bearing to the destination (Mercator is conformal, so the bearing is the
   map angle) -> yaw rate limited and smoothed -> bank follows yaw rate (<= ~0.2 rad, roll applied to the camera up vector)
   -> advance at a constant *ground* speed (`BASE_MS` x multiplier / `groundMPerUnit()`), so speed stays right as Mercator
   stretches. Positions stay in world units that N1's re-anchor already shifts; nothing absolute is cached.
3. *Altitude.* Cruise just above the deck (y ~ 6.5, slow drift). Now and then (and when terrain ahead is rough) dip to
   (highest ground ahead + clearance); climb/descent rate limited; a look-ahead floor sampled with `surfaceY` over the next
   ~2 s plus a hard floor under the camera, so it never clips. Pitch follows the climb angle.
4. *Arrival.* Within a few km of the city: next destination (nearest-ish unvisited big city 150-800 km away, weighted by
   population; farther if none), optionally one orbit lap (constant-rate turn) first while touring.
5. *Takeover.* Drag/WASD -> manual (autopilot paused, destination kept). R / button -> autopilot resumes from the current
   position and heading (heading converges by the yaw-rate limit, so no snap).
6. *Controls/HUD.* Store: `apSpeed` (1x-10x), `todMult` (day/night clock multiplier, in the Time tab), `hud`, `dest`, `tour`.
   Place tab: city list with filter, "Fly to", "Tour", Stop. HUD: nearest city + state, lat/lon, altitude (m above ground),
   local solar time (scene `tod` at the start place + lon offset / 15 h; the sun follows it), destination + distance.
7. *Test.* NYC -> LA at high speed via dev helpers; log frame times, clearance, window swaps, re-anchors.

**N2 result** (branch `claude/n2-autopilot-cdf2c2`): autopilot, HUD, Place-tab controls done; `npm run build` passes.
- *NYC to LA (3,940 km) at 10x (18 km/s, 98 units/s):* flew to Los Angeles, arrived, picked Stockton. 12 re-anchors, ~160 window swaps
  (load time fell to 0.17 s once tiles were cached), no errors. Lowest height over the ground 13.5 units (dips; the floor is 3.2),
  max bank 0.22 rad, max yaw rate 0.38 rad/s. No position jumps at re-anchors or window swaps (per-step displacement == speed x dt).
  The preview pane was hidden for part of the run (1 fps rAF), so the second half was stepped with `engine.advance(0.05)` in bursts;
  frame-time figures from that part mean nothing. Frame time at 10x while the pane was visible: 120 fps.
- *Takeover/handback:* key/drag takeover keeps the autopilot's velocity and eases out; R resumes from the same position/heading
  (heading and speed ease back in). Max per-frame turn at handback 0.0002 rad, max per-frame speed change 0.3 u/s.
- *HUD spot check:* 40.60 N 74.13 W reads "Over Elizabeth, NJ"; 38.33 N 104.23 W reads "34 km E of Pueblo, CO" (Pueblo is 38.27 N 104.61 W).
- *Dips:* over the Rockies at 4x it dropped from y 7 to -40 (13 above ground) and climbed back; clearance never under 12.5.
- Open: the ~40 ms window-bake frame was not re-measured (pane hidden, so timings unreliable); not fixed. Zoom doesn't change on huge
  latitude swings (N1 note). Orbit laps pass tangentially around the city at radius = speed / turn rate (15 km at 1x, ~40 km at 6x).
- For N3: world lights should key off `camLatLon()`/the GeoRef; the sun/`tod` is now local solar time (`localHour(lon)` in `applySun`), so
  daylight changes with longitude while flying east/west (setting "Sun follows longitude"); the HUD store is `store/hud.ts`; `ap.dest`,
  `useSettings.dest`, `tour` drive the route. Cruise y is 6.5 (just above the deck), dips go to ground + 13.

**N2 follow-up: cloud rendering at any heading** The cloud march's stable, world-fixed sample planes only existed for rays heading toward -z
(the old fixed path); every other heading (east, south, behind) fell back to a jittered march, which showed as stripe artifacts. Now the planes
are perpendicular to whichever horizontal axis the ray runs along most (mirrored, so the grid stays aligned), so all headings get the planar
sampling. March reach raised from 200-320 to 560-800 units (`FAR_LO`/`FAR_HI` in `legacy.ts`): far cumulus towers now reach the horizon; ~90-120 fps in
the preview at 0.55 render scale. Checked north, east, behind, from above (y 30, looking down) and from beneath (y -30). Not changed: the packed
depth for TAA still caps at 250 units (farther cloud reprojects as at infinity), the 320-unit cloud tile still repeats (N1's variety noise hides it).

**N2 follow-up: cloud shape variety** (`legacy.ts`: `cumulusLayer`, `cumulonimbus`). Cumulus is two grids now (small heaps, and fewer big towering
ones, 5 cells per 320 tile) with a slow cluster field that groups heaps into banks with gaps; each heap has its own 5-8 bubbles, elongation and
heading, height (flat to tall) and bubble sizes. Storm towers: 16 per tile instead of 9, each with its own height, girth profile (taper/bulge),
wind shear direction and strength, anvil size, and often a second smaller updraft. Bake time unchanged within noise (~4.4 s here, pane throttled).
Tuning knobs: the `cumulusLayer` calls in `towers()` (size, density, height) and `uStorm * 0.6` gating in `cumulonimbus`.

**N2 follow-up: MSFS-style clouds (1 of 2)** `wideCloud` (new): broad flat-based storm masses (radius 15-25, 10 tiered bubbles, base up to 6 above the deck), density follows `storm`.
Per-cloud shades: a patchy "heaviness" noise (`hv` in `CLOUD_FRAG`, ~1 patch per cloud) raises extinction toward the sun/moon and cuts ambient fill, with a
stronger dark-underside gradient and a slight warm/cool tint; halved at night. Daytime haze cut to 40%. Checked at noon: white tops, grey-to-dark bases,
bright and heavy clouds side by side; 120 fps in the preview. Still to do: finer surface detail octaves, a second (stratocumulus) layer, daytime tuning of
the neutral grey (undersides are still a bit blue).

**N2 follow-up: MSFS-style clouds (2 of 2)** Finer surface creases (two extra detail reads, near the camera only); `stratSD`: a second, higher layer
of flat-bottomed stratocumulus in long rows (base y~19-21, follows `cover`/`deckH`), so cruise (y 6.5) flies between two decks; daytime ambient made
neutral grey instead of blue. Checked at noon from cruise (layered sky, grey-white shades) and from above (y 30); 120 fps in the preview.

### N3: Real night lights + glow under clouds
- [ ] Plan written here
- [ ] Real lights from NASA Black Marble (GIBS WMTS, public domain, keyless) in the terrain window,
      with the generated lamps as fine detail on top
- [ ] Orange glow on the underside of clouds above cities
- [ ] Highways and towns read correctly from 3 km and 10 km at night
- [ ] Build passes; night screenshots over a big city

### N4: Sharper imagery near the camera
- [ ] Plan written here
- [ ] Nested higher-zoom window near the camera (Sentinel-2 to its max zoom; NAIP 1 m only if a keyless
      public tile source exists), blended, fixed memory budget
- [ ] No pops or seams between levels; attribution updated
- [ ] Build passes; screenshots at 3 km and 10 km vs the Apple Maps references

## Master integration
- [x] N1 merged into main (3940049). Open: occasional ~40 ms frame at the end of a window bake.
- [ ] Merge each step after review
- [ ] Performance check on the user's machine
- [ ] README update
