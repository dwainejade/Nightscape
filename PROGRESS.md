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
- [x] Coast-to-coast test: no seams, jumps or precision jitter; build passes

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
- [ ] Plan written here
- [ ] City list (reuse `volumetric-clouds/public/usa/cities.json`, or a keyless world list)
- [ ] Route: pick a destination, fly a smooth great-circle heading over real terrain, gentle banking and
      altitude changes, then the next city
- [ ] Manual takeover with WASD/drag; R hands control back (keep the current behaviour)
- [ ] Speed and time multiplier; HUD: nearest place, lat/lon, local time, destination
- [ ] Build passes; a long autopilot run with no errors or ground clipping

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
- [ ] Merge each step after review
- [ ] Performance check on the user's machine
- [ ] README update
