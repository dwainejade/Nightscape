# Nightscape

A live, endless flight just above a moonlit sea of clouds, rendered in real time in the browser with WebGL 2 and Three.js.

**[Open the live demo](https://weeblabs.github.io/Nightscape/)**

Be sure to stop by the [Weeb Labs Discord server](https://discord.gg/RCyqxAQ5xS), where you'll find plenty of impassioned nerbs sharing their creations and offering a helping hand!

![A flight over a sea of clouds at night as the full moon comes out from behind a tall cloud](media/flight.gif)

*The flight in this clip runs at 2.6 times its normal speed, without film grain.*

## Contents

- [What it is](#what-it-is)
- [Aims](#aims)
- [Getting started](#getting-started)
  - [Requirements](#requirements)
  - [Running it](#running-it)
  - [Using it as a wallpaper](#using-it-as-a-wallpaper)
- [Controls](#controls)
- [Settings](#settings)
  - [Colour](#colour)
  - [Weather](#weather)
  - [Sky](#sky)
  - [Sound](#sound)
  - [Display](#display)
  - [Saved settings](#saved-settings)
  - [Page options](#page-options)
- [What is in the scene](#what-is-in-the-scene)
- [How it renders](#how-it-renders)
  - [Render passes](#render-passes)
  - [A world that tiles seamlessly](#a-world-that-tiles-seamlessly)
  - [Baked lighting and cloud shape](#baked-lighting-and-cloud-shape)
  - [Sampling built for stability](#sampling-built-for-stability)
  - [Temporal accumulation](#temporal-accumulation)
  - [Adaptive resolution](#adaptive-resolution)
- [Recording video](#recording-video)
- [Optimisations still to make](#optimisations-still-to-make)
- [Known limitations](#known-limitations)
- [Development history](#development-history)
- [Files](#files)
- [Community and support](#community-and-support)
- [Credits](#credits)
- [Licence](#licence)

## What it is

Nightscape is a single web page that renders a night flight over the top of a cloud layer. The camera drifts slowly forward along the cloud tops, passing cumulus heaps and tall cumulonimbus storm towers. A full moon hangs low ahead, lighting silver edges on the clouds and casting light shafts between them. Through breaks in the cloud you can see flooded mountains far below, with forests, lakes, small towns and radio masts with blinking warning lights. Now and then a storm tower flashes with lightning or a shooting star crosses the sky.

Everything is in one self-contained file, `index.html`. The only external request is Three.js r128 from cdnjs. Nothing is pre-rendered: the clouds are ray-marched every frame, and the lighting, terrain and town lights are generated and baked on the GPU when the page opens.

## Aims

The project is meant to be a live wallpaper that you can leave running for hours. Four aims guide its design:

- **Live.** The scene is generated and animated in real time rather than played back from a video. The flight never cuts or loops visibly, and events such as lightning and shooting stars arrive at random.
- **Calming.** Motion is slow and smooth. Changes are gradual, the palette is soft, and nothing on screen demands attention. Lightning is mostly dim glows deep inside the clouds, and both lightning and shooting stars can be made rarer or turned off.
- **Realistic.** The clouds follow how real clouds form and how light scatters through them. The moon is the real near side, mapped from NASA lunar data. Stars twinkle more near the horizon, lightning behaves like real ground strikes and in-cloud flashes, and the ground is lit only where the cloud deck lets moonlight through.
- **Semi-interactive.** The scene needs no input, but it responds gently when you give it some. Moving the mouse turns your gaze slightly. A panel lets you grade the colours and tune the weather, sky, ground, sound and performance, and keys send a lightning flash or a shooting star on demand.

A large share of the work has gone into stability. Clouds must not shimmer, boil, pop or change shape as the camera moves, because any of those breaks the calm at once.

## Getting started

### Requirements

- A current desktop browser with WebGL 2: Chrome, Edge, Firefox or Safari.
- A discrete or recent integrated GPU. The page adapts its cloud resolution to keep motion smooth, so slower GPUs get a softer image rather than a slower one.
- `EXT_color_buffer_float` support for temporal accumulation. Most desktop GPUs have it. Without it the page still runs, but without accumulation the clouds are noisier.

### Running it

The quickest way is the live demo at [weeblabs.github.io/Nightscape](https://weeblabs.github.io/Nightscape/), which GitHub Pages serves from the `main` branch.

To run it locally, open `index.html` directly in a browser, or serve the folder with any static file server, for example:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765`. The page bakes its lighting and terrain for a second or two at startup. A "Lighting the clouds…" note appears only if this takes longer than about half a second.

### Using it as a wallpaper

Any tool that can show a web page full screen or as a desktop background can run the scene. Options include a browser window in full-screen or kiosk mode, and live-wallpaper apps that accept a URL (such as the live demo address) or a local HTML file, such as Plash on macOS or Lively Wallpaper and Wallpaper Engine on Windows. These apps have not been tested with this project, so check that the one you choose provides WebGL 2.

Settings you choose in the panel are saved in that browser's local storage. A wallpaper app usually keeps its own storage, so set up the scene inside the app if it lets you interact with the page.

## Controls

| Input | Action |
| --- | --- |
| Mouse movement | Turns your gaze gently toward the pointer, up to about 7° sideways and 3° up or down, with heavy damping |
| Double-click, or `F` | Toggles full screen |
| `G`, or the button in the corner | Opens or closes the settings panel |
| `Esc` | Closes the settings panel |
| `L` | Sends a lightning flash now |
| `Shift`+`L` | Sends a distant storm flash now, each time from a new position |
| `M` | Sends a shooting star now |
| `P` | Sends an aircraft now |
| `S` | Turns sound on or off. If sound is on but has not started yet, it starts it |

In the settings panel, the left and right arrow keys move between tabs when a tab has keyboard focus, and `Home` and `End` jump to the first and last tab. The other keys are ignored while a panel control has keyboard focus. The pointer and the closed panel button fade out after 2.5 seconds without mouse movement, and come back when you move the mouse.

If your operating system is set to reduce motion, the flight runs at 35% of its normal speed and lightning flashes are softer, slower and single, with no rapid flicker.

## Settings

Press `G` or click the corner button to open the panel. Its settings are organised into five tabs, Colour, Weather, Sky, Sound and Display, which match the sections below. The tab bar stays in view while a long tab scrolls, and the panel reopens on the tab you used last. Every change takes effect immediately.

### Colour

The grade is applied in the final pass, after ACES tone mapping, so it costs nothing measurable per frame. Five presets set every control at once:

| Preset | Look |
| --- | --- |
| **Teal Night** (default) | Blue-green night with teal shadows and pale mint highlights |
| **Moonlit Blue** | Cooler and plainer, with blue shadows and a faint warm highlight |
| **Golden Moon** | Warm moonlight over blue clouds, with stronger light shafts |
| **Deep Sea** | Saturated cyan-teal with deep shadows |
| **Silver** | Nearly monochrome |

Changing any control switches the panel's label to "Custom grade". **Reset** returns every grade control to the selected preset, or to Teal Night once you have customised the grade.

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| Exposure | 0.40 to 2.00 | 1.15 | Overall brightness of the image |
| Temperature | Cool -1 to Warm +1 | -0.35 | White balance along the blue to amber axis |
| Tint | Magenta -1 to Green +1 | +0.35 | White balance along the magenta to green axis |
| Light shafts | 0 to 2 | 1.00 | Strength of the moonlight beams that streak past clouds crossing the moon |
| Saturation | 0 to 2 | 1.10 | Colour intensity, from greyscale at 0 to double at 2 |
| Contrast | 0.70 to 1.50 | 1.05 | Separation between dark and bright tones |
| Shadow tint | 0 to 1, plus a colour | 0.50, `#0f8f86` | Split toning: how strongly the chosen colour tints the shadows |
| Highlight tint | 0 to 1, plus a colour | 0.25, `#c4ece2` | Split toning: how strongly the chosen colour tints the highlights |
| Night glow | 0 to 1.50 | 0.70 | Lifts the blacks toward the shadow colour, so the darkest areas read as night air rather than flat black |
| Vignette | 0 to 0.80 | 0.38 | Darkens the corners and edges of the frame |
| Grain | 0 to 30 | 7 | Film grain strength (stored as 0 to 0.03). The grain is soft clumps about 1.5 pixels across, scaled with the screen, plus a finer sparkle. It is mostly neutral with a hint of colour, strongest in the shadows and midtones, and refreshed 24 times a second. A faint separate dither prevents banding even at 0 |

### Weather

**Lightning nearby**

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| Lightning in the storm clouds | On or off | On | Turns automatic lightning on or off |
| Storm activity | ×0.25 to ×3 | ×0.25 | How often lightning flashes. The average wait between flashes is 9 seconds divided by this value, and never less than 2.5 seconds |
| Minimum gap | 2.5 s to 3 min, logarithmic | 40 s | The shortest quiet spell before lightning can flash again, the first flash after loading included. At the far left, storms may flash in quick bursts, with a 30% chance of a follow-up flash within about two seconds. Any higher setting turns bursts off, so the gap holds between every pair of flashes |
| Flash now | Button | | Sends a flash immediately, like `L`. It ignores the minimum gap |

**Distant storms**

Storms far beyond the horizon flicker silently now and then, lighting the sky low over the horizon. Each storm keeps flashing from one direction for a while, then another builds somewhere else in view.

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| How often | Off to 12 per minute | 3 per minute | The average rate of distant flashes. The readout shows the average wait, such as "every ~20 s" |
| Brightness | ×0.1 to ×3 | ×1 | How bright the glow gets. Each storm also has its own strength, as some are nearer than others |
| Width | ×0.4 to ×3 | ×1 | How wide the glow spreads. At ×1 it reaches about 1.7° to 4° to either side, varying by storm |
| Height | ×0.4 to ×3 | ×1 | How high above the horizon the glow reaches. At ×1 it fades over 1° to 2° |
| Colour | Cool to Warm | Warm | The glow's colour, from blue-white to orange. Brightness stays the same across the range |
| Flicker | Single pulse to 8 pulses | Up to 5 | The most pulses one flash can have. Each flash picks a random number up to this, and each pulse lights a slightly different part of the storm |
| Flash length | ×0.4 to ×3 | ×1 | How long a flash's train of pulses lasts, and how slowly each pulse fades. At ×1 a flash lasts up to about a second |
| Storm moves on after | 10 s to 5 min | ~75 s | The average time a storm keeps flashing from one place before the next storm appears somewhere else |
| Spread across the view | 10% to 100% | 85% | How far from the centre of the view a new storm can appear, as a share of the distance to the edge. Storms always keep at least 10° clear of the moon |
| Light on nearer clouds | None to ×3 | ×1 | How much the glow catches the thin edges of clouds in front of it and washes over the nearer clouds |
| Reset | Button | | Returns every distant-storm setting to its default |
| Distant flash | Button | | Sends a distant flash immediately from a new position, like `Shift`+`L` |

### Sky

**Stars**

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| Twinkle | Steady 0 to Strong ×2 | ×1.40 | How much the stars flicker. Twinkling is always deeper near the horizon, where starlight passes through more air |
| Stars reach down to | 0° to about 20° above the horizon | 2.0° | The lowest elevation at which stars appear (stored as the sine of the angle, 0 to 0.35) |

**Shooting stars**

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| How often | Off to 6 per minute | 2 per minute | The average rate of shooting stars. The readout shows the average wait, such as "every ~2 min". They arrive at random, so actual gaps vary widely |
| Shooting star | Button | | Sends a shooting star immediately, like `M` |

**Aircraft**

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| How often | Off to every 20 min | Every ~8 min | The average time between aircraft. Each gap is random, between 75% and 125% of this, and a new aircraft never starts while the last one's contrail is still in the sky |
| Light brightness | ×0.2 to ×3 | ×1 | Brightness of the white light and the blinking red and green wingtip lights |
| Contrail | None to ×3 | ×1 | Brightness of the contrail |
| Contrail lasts | ×0.3 to ×3 | ×1 | How slowly the contrail fades. At ×1 it fades over about 2.5 minutes |
| Contrail glitter | None to ×3 | ×1 | How strongly ice crystals in the contrail glint in the moonlight |
| Reset | Button | | Returns every aircraft setting to its default |
| Aircraft | Button | | Sends an aircraft immediately, like `P`. It starts at the far end of its course, so it may first appear as a faint point near the horizon |

**Ground**

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| Town lights | Off to ×3 | ×1.95 | Brightness of the town, road and farmhouse lights and the glow they cast on the ground and lakes. It is a single multiplication at render time and needs no rebake. It does not affect the red mast lights |

### Sound

The page has a soft, endless wind and low thunder that follows each lightning flash. Both are generated in the browser from noise with the Web Audio API, so there are no sound files. Browsers only allow a page to play sound after you interact with it, so sound starts, fading in, on your first click or key press. Until then the panel shows "Click anywhere to start sound".

| Control | Range | Default | What it does |
| --- | --- | --- | --- |
| Wind and thunder | On or off | On | Turns all sound on or off. `S` does the same. Turning it off fades the sound out and then pauses audio processing completely |
| Volume | 0% to 100% | 60% | Overall level of all sound |
| Wind | 0% to 100% | 50% | Level of the wind. It rushes and eases in slow gusts that never repeat exactly |
| Whistle in the gusts | 0% to 100% | 40% | How strongly the wind whistles. The whistle rises in the stronger gusts, drifting in pitch, and fades in the lulls |
| Thunder | 0% to 100% | 70% | Level of the thunder |
| Thunder delay | None to ×2 | ×1 | Scales the gap between a flash and its thunder. At ×1 the gap is 0.8 seconds plus about 1.2 seconds for every 100 units of distance, so typically 2 to 5 seconds |

Sound pauses while the page is hidden, for example in a background tab, and resumes when it is shown again.

### Display

| Item | Range | Default | What it does |
| --- | --- | --- | --- |
| Clouds | Readout | | The resolution the cloud pass is rendering at |
| Screen | Readout | | The window's real pixel resolution |
| Frame rate | Readout | | Frames per second, measured live |
| Cloud resolution | 15% to 100% | Automatic | The cloud pass's resolution as a share of the screen's real pixel width and height. Moving the slider pins it and turns automatic adjustment off |
| Adjust automatically to keep motion smooth | On or off | On | Lets the page choose the cloud resolution, between 26% and 80%, from measured frame times. Wide hysteresis keeps changes rare |

### Saved settings

All settings are saved per browser in `localStorage`, under these keys:

| Key | Holds |
| --- | --- |
| `moonlit-cloud-sea:grade:v1` | Colour grade and selected preset |
| `moonlit-cloud-sea:storm:v1` | Lightning on or off, storm activity and minimum gap |
| `moonlit-cloud-sea:distant:v1` | All distant-storm settings |
| `moonlit-cloud-sea:aircraft:v1` | All aircraft settings |
| `moonlit-cloud-sea:sky:v1` | Twinkle, star reach, shooting star rate and town light brightness |
| `moonlit-cloud-sea:quality:v1` | Cloud resolution and whether it adjusts automatically |
| `moonlit-cloud-sea:sound:v1` | Sound on or off, and the five sound levels |
| `moonlit-cloud-sea:tab` | The settings tab you used last |

To return everything to the defaults, clear the site's storage in the browser, or run `localStorage.clear()` in its developer console and reload.

### Page options

| URL | Effect |
| --- | --- |
| `index.html?noclouds` | Hides the clouds to show the ground on its own, for inspecting the terrain |

## What is in the scene

**Cloud deck.** A thick stratocumulus layer whose altitude varies across the world. Broad basins sink well below the camera, while banks and ridges swell past eye level to the sides. The flight corridor is kept low, so the camera skims over the deck rather than through it. A large-scale coverage field opens breaks of every size, from small ragged gaps to wide openings.

**Cumulus heaps.** Each heap is built the way real cumulus grows, as a cluster of six rounded thermal bubbles. The bubbles are large and spread out at the base, smaller and higher toward the top, and each is nudged downwind. Some heaps come out low and wide, while others stack into lopsided turrets. Two scales of rounded lumps on the surface give the cauliflower texture.

**Cumulonimbus.** A few storm towers stand in each world tile, mostly mid-sized with occasional giants. Each has a broad, lumpy updraft column that leans slightly with height. The tall ones flatten into an anvil dragged out by upper-level wind, with an overshooting dome punching through the top. They are kept clear of the flight path, so you pass beside them and sometimes under the anvils.

**Flooded mountains.** About 85 units below the camera lie eroded ranges with sharp ridges, gullies and smooth valley floors, half drowned so the valleys become winding lakes and fjords. Forest covers the gentler slopes below a ragged tree line and gives way to meadow and bare rock on cliffs and peaks, with a dark wet band along the shores. The low moon throws long shadows across the ranges and lays a soft glitter path on the lakes. The lakes reflect the sky and the surrounding mountains. The cloud deck's shadow falls on all of it, so only ground under a break is moonlit.

**Town lights.** Small towns of warm, sodium-orange street lights sit on dry, gentle ground near the valley floors and shores, about 18 per world tile. Each town is a loose street grid that thins out toward its edges. Strings of road lamps wind between neighbouring towns, skirting lakes and steep slopes, and single farmhouse lights dot the countryside in between. Every lamp lights the ground around it, and nearby lakes pick up a faint warm glow.

**Radio masts.** The two highest summits in each world tile carry a thin lattice mast about 1.8 units (roughly 70 m) tall. Each has a red aircraft warning light on top that flashes every two seconds, out of step with the other mast, and a steady dimmer red light halfway up. A flash faintly reddens the summit around the mast's foot.

**Moon and sky.** The moon uses NASA's Lunar Reconnaissance Orbiter albedo map, embedded in the page. It shows the real near side, north up, with the maria and Tycho in their correct places, inside a layered halo. The sky is a deep gradient with a warm glow along the horizon under the moon. Procedural stars fade near the moon's glare, twinkle irregularly a few times a second, and reach to within about 2° of the horizon. A few bright stars sit low ahead, dimmed and reddened by the thick air, and the lowest is a steady reddish planet.

**Shooting stars.** By default a meteor crosses the sky about twice a minute, at random. Both ends of its path are picked on screen, so the whole streak is visible. It stays at least 6° up, clear of the moon, heading generally downward and burning out above the horizon. Each one is a pixel-thin line with a hot blue-white head and a warmer fading trail, and it lasts 0.3 to 2 seconds. About one in twelve is a brighter, longer fireball. Clouds hide shooting stars just as they hide the stars.

**Lightning.** Every so often one of the storm towers near the camera flashes. There are three kinds of flash:

- **Deep flashes** make up about two in three. They fire in the core of the tower, and their light scatters through so much cloud that the tower only glows softly from within.
- **Ground strikes** make up about one in five. A faint stepped leader works its way down, followed by one to four return strokes tens of milliseconds apart, some with a flickering continuing current. Some strikes leave the cloud base and show only through breaks in the deck. Others leave the side of the tower and arc through clear air, a so-called "bolt from the blue". Ten candidate channels are tested against the cloud field, and the one the camera sees best is used.
- **In-cloud flashes** make up the rest. They fire between charge regions near the tower's surface as a train of pulses that wander along the channel. On towers with an anvil, some run as "crawlers" just under the anvil base.

Each flash lights the cloud from inside along its channel. Light from a buried channel scatters many times before it escapes, so it fades far more gently than direct moonlight and spreads through the whole tower. A ground strike also lights the land, water and rainy air around its strike point. The visible bolt is drawn at full resolution as a jagged, branching channel, and cloud in front of it hides or veils it.

**Aircraft.** Every eight minutes or so, an airliner cruises far above the clouds on a random straight course. About two in five pass more or less overhead, coming toward the camera or heading away into the distance, and the rest cross slowly far off, low over the horizon. Each course is checked against the view and used only if the aircraft stays in sight for at least 40 seconds. The aircraft shows a tiny steady white light and red and green wingtip lights that blink alternately, on the correct sides for its direction. Its contrail is a moonlit line that starts a short way behind it, spreads wider and fades as it ages, and is brighter toward the moon. Now and then a single ice crystal in the trail glints faintly for about a second. Clouds hide the aircraft and its trail, and both are dimmer low down, where their light crosses more air.

**Distant storms.** Now and then a storm far beyond the horizon, too far away to hear, flickers. Its light shows as a soft glow low in the sky, sitting behind the cloud layer, so the distant cloud tops stand out dark against it while their thin edges catch a little of the light. A flash is a short train of soft pulses, each lighting a slightly different part of the storm. A storm stays in one direction for a while before another builds elsewhere in view, so flashes repeat from the same place as a real storm's would.

**Sound.** The wind is pink noise, which has equal energy in every octave, like a steady rush of air. A low-pass filter whose cutoff rises and falls with the gusts shapes it. Two narrow band-pass filters on the same noise give the whistle. Their pitch drifts with the gusts, and they only sound when the wind is strong. The gusts come from three slow swells whose periods never line up, so the pattern never repeats.

Each lightning flash schedules its own thunder. It is brown noise, which is heavy in low frequencies, through two low-pass filters. It opens with a soft swell, a little quicker for ground strikes, then rolls on in two to five weaker waves over 4 to 9 seconds. Distance delays the thunder, makes it quieter and takes away more of its higher rumble, and a flash deep inside a tower sounds the most muffled. The thunder is panned left or right towards the flash. A gentle limiter on the output keeps overlapping thunder from getting harsh.

**Light shafts.** A screen-space radial pass streaks moonlight past whatever is in front of the moon, so beams fan out when a tower crosses it.

## How it renders

### Render passes

Each frame runs five full-screen passes, plus a sixth while a lightning bolt is visible:

1. **Cloud pass**, at reduced resolution. It ray-marches the cloud volume per pixel and outputs scattered light, transmittance and a depth estimate.
2. **Ground pass**, at the same resolution. For pixels that see down through a break, it finds and shades the terrain behind whatever cloud is left in front. Every other pixel passes straight through. Keeping the ground out of the cloud pass keeps that shader lean.
3. **Temporal accumulation.** It blends the new frame with the reprojected history to remove residual noise and stabilise edges.
4. **Light shafts.** A radial blur toward the moon's screen position.
5. **Lightning bolt**, at full resolution and only during a flash. It draws the channel as screen-facing strips into its own buffer.
6. **Composite**, at full resolution. It draws the sky, stars, shooting stars and moon, combines them with the clouds and shafts, then applies tone mapping, the colour grade and film grain.

### A world that tiles seamlessly

The world is a 320 by 320 unit tile repeated forever in both horizontal directions. Every noise lookup uses a frequency with a whole number of cycles per tile. The cumulus grid has 13 cells per tile and the cumulonimbus grid has 3. The flight path is a sum of sines with one and two cycles per tile. As a result the clouds wrap with no seam, and the flight is endless without ever cutting or jumping. At the cruising speed of 1.25 units per second, the scenery repeats about every 4¼ minutes.

The clouds are defined as a signed-distance-like shape field: deck, cumulus and cumulonimbus combined with smooth unions. A tileable 64³ noise texture generated on the CPU at startup provides the detail. Its channels hold Perlin-Worley billows, a Worley detail field and smooth Perlin noise.

### Baked lighting and cloud shape

The moon and the clouds never move, so most of the lighting is computed once on the GPU when the page loads. For every point of the tile, the cloud bake records:

- **Optical depth toward the moon**, from a march of about 300 units, so tall clouds cast long, soft shadows.
- **Optical depth straight up**, used for ambient occlusion in basins and under cloud bodies.
- **The cloud shape itself**, as a signed distance.

The bake runs in small chunks across several frames to avoid stalling the GPU. It renders into a 2D atlas of slices, which is read back and uploaded as a 256 by 96 by 256 3D texture that wraps with the tile.

At render time the cloud shape is read from the bake, and one octave of finer live billowing is added on top. In clear air a sample is a single texture read, and the baked distance also says how far a ray can safely skip. This made the cloud pass roughly five times cheaper than rebuilding the full field per sample.

Each cloud sample takes two crisp local samples toward the moon, so edges stay sharp, and reads the bake for everything beyond. Shading combines Beer-Lambert transmittance, a dual-lobe Henyey-Greenstein phase function, a three-octave multiple-scattering approximation, a "powder" term for darkened edges, and height- and occlusion-weighted ambient light. Haze thins with altitude, so distant storm towers stay visible.

The terrain is baked after the clouds into five tiling 1024 by 1024 textures:

- **Height**: the ground plus a tree canopy of crowns in clumps, with forest density and rock grain.
- **Light**: moonlight with soft shadows, and how much sky each point sees past the surrounding ridges.
- **Colour**: forest, meadow, rock, shore and lake bed.
- **Horizons**: how high the land rises in four directions from each point, which tells a lake whether its reflection shows a mountain or sky.
- **Lamps**: the town and road lamps as small bright points, plus the light they cast around them.

Each frame then finds where a ray meets the ground with a height-field march and adds only the live parts: the cloud shadow, the moon's glitter, fine texture up close and the mast lights. A CPU copy of the heights places lightning strike points and radio masts on the real surface.

### Sampling built for stability

Most of the development effort went into making the clouds hold still while the camera moves.

- **World-anchored samples.** View rays sample the cloud on planes fixed in the world rather than at distances from the camera, so flying forward never slides the sample slices through a cloud. Spacing starts at 0.06 units and doubles at 5, 10, 20, 40, 80 and 160 units out.
- **Blended spacing changes.** Over the far half of each distance band, every other plane fades out and its neighbours take over its share, so the switch to coarser spacing is gradual.
- **Clean band hand-off.** When a ray's next sample falls past a band edge, it is placed on the coarser band's grid, so no plane exists only until the edge moves past it.
- **Surface refinement.** Near a cloud surface, rays drop to a twice-as-fine set of world-anchored planes, so small puffs and wisps cannot slip between samples.
- **Softer distant edges.** The density ramp at cloud edges widens with distance, so a tiny shift of a thin distant wisp does not cause a large jump in opacity.
- **Conservative empty-space skipping.** Rays skip through clear air by only a fifth of the baked distance, because near anvils and turrets the field changes up to about 6.7 times faster than true distance.
- **Soft far limit.** Rays march up to 200 units, or 320 for rays climbing above the horizon, and cloud fades out over the last 45 units, so whole slabs of distant cloud never appear or vanish at once.
- **No per-frame randomness in the clouds.** With the camera still, consecutive frames are identical.

### Temporal accumulation

The cloud pass writes depth with transmittance into a 32-bit float target. The accumulation pass uses that depth to reproject each pixel into the previous frame. It clamps the history to the current 3 by 3 neighbourhood's colour range to prevent ghosting, then blends, leaning more on the new frame where motion is fast. The accumulated image carries over when the render resolution changes, so a resolution change never resets the image to noise.

### Adaptive resolution

By default the cloud and ground passes render at 26% to 80% of the window's size, adjusted from measured frame times with wide hysteresis. Everything drawn at full resolution, including the moon, stars, bolt, grain and colour grade, stays sharp regardless.

## Recording video

`tools/record.mjs` renders the scene offline into an H.264 video, frame by frame, so slow frames never cause stutter and lightning and shooting stars can be placed at exact times. It needs Node 22 or later, Google Chrome and ffmpeg.

```bash
node tools/record.mjs tools/example-video.json
```

The script serves the project folder on port 8777 and starts headless Chrome on the GPU, controlling it over the Chrome DevTools Protocol on port 9333. It seeds `Math.random`, so a given configuration always produces the same video. It then steps the scene with `window.__cloudScene.advance(dt)`, reads each frame back as a PNG and pipes it into ffmpeg. Set the `CHROME` environment variable if Chrome is not in its usual place.

The configuration file accepts these fields:

| Field | Meaning |
| --- | --- |
| `mode` | `"video"`, or `"stills"` to save one PNG per entry in `times` |
| `w`, `h` | Output size in pixels |
| `scale` | Cloud resolution as a fraction of the output size, 1 for full |
| `fps` | Output frame rate |
| `sub` | Simulated frames per output frame. 2 at 30 fps simulates at 60 Hz, so temporal accumulation behaves as it does live |
| `t0` | Where in the flight to start, in seconds |
| `speed` | How fast the camera moves, as a multiple of its normal pace. Twinkle, lights and lightning still run in real time |
| `seconds` | Video length |
| `crf`, `preset` | x264 quality and speed settings |
| `seed` | Random seed |
| `storage` | Optional saved settings to load, keyed by the `localStorage` keys listed in [Saved settings](#saved-settings) |
| `events` | Scripts to run at given times. `__pick(kind, test)` re-rolls a flash of kind `deep`, `cg` (ground strike) or `ic` (in-cloud) until `test` accepts it, `window.__cloudScene.meteor(fireball)` sends a shooting star, and `window.__cloudScene.farFlash()` sends a distant storm flash, and `window.__cloudScene.aircraft()` sends an aircraft |
| `out` | Output file, relative to the configuration file |
| `frames` | Optional folder, relative to the configuration file, to save numbered PNG frames in instead of making a video, for example to build a GIF |

Automatic lightning, distant storms, aircraft and shooting stars are disabled while recording, so only the scripted events happen. Recordings are silent. On an Apple M1 Max a 60-second 1080p video at the example settings takes about 11 minutes.

## Optimisations still to make

- **Temporal upsampling.** Rendering a quarter of the cloud pixels each frame in a rotating pattern and rebuilding the rest from recent frames could make the cloud pass three to four times cheaper on top of the baked shape.
- **A frame-rate cap for wallpaper use.** The page renders at the display's full refresh rate. An optional cap at 30 fps, and a lower rate while the page is hidden behind windows, would cut power use substantially for a scene that moves this slowly.
- **Render the bake straight into the 3D texture.** The cloud bake currently renders into a 2D atlas, reads it back to the CPU and uploads it again. WebGL 2 can render directly into 3D texture layers, which would remove the round trip and shorten startup.
- **Cache the bakes.** The terrain and clouds are identical on every load, so the baked textures could be stored in IndexedDB and reused on later visits, making startup almost instant.
- **Smaller bake formats.** Some baked channels could use half-float or 8-bit formats, lowering memory use and bandwidth on integrated GPUs.
- **Quicker shader start-up.** Compiling the shaders with `KHR_parallel_shader_compile`, where supported, would keep the page responsive while it starts.
- **Faster recording.** The recorder encodes each frame as a PNG in the browser and sends it to ffmpeg as text, which dominates its run time. Reading raw pixels or encoding in the page with WebCodecs would be several times faster.
- **Ship Three.js locally.** Bundling Three.js with the page would remove the single network request and let the scene run fully offline.

## Known limitations

- **The scenery repeats** about every 4¼ minutes. Streaming the bake, which means baking new sky ahead of the camera and discarding what is behind, would make it never repeat.
- **Startup bake time** is a second or two on a typical discrete GPU, and longer on integrated graphics.
- **Slower GPUs** run at a reduced cloud resolution, so the clouds look softer.
- **Distant anvils** can occasionally read as mushroom caps. Stretching them further downwind and thinning their edges would help.
- **Clouds in the shadow** of a large cumulonimbus can look flat. Skylight relief was strengthened, but there is room for more.
- **Sound needs a click or key press** before it can start, because browsers block sound on pages the viewer has not interacted with. A wallpaper app that never passes input to the page may never start the sound.

## Development history

The scene was built iteratively from a short brief and reference photos of moonlit clouds. In order:

1. **First version.** A ray-marched cloud deck with procedural towers, live light marching toward the moon, light shafts, moon, stars, ACES tone mapping and adaptive resolution.
2. **Breaks in the deck.** A coverage field opened gaps through the uniform deck.
3. **Darker sky.** The halo, horizon band and light-shaft veil were reduced.
4. **Varied deck heights.** Basins and banks were added around a clear flight corridor, and a skipping bug that drew a phantom layer and a bright horizon line was fixed.
5. **Shimmer.** Per-frame random sampling made the clouds boil. Temporal accumulation with depth-based reprojection fixed most of it.
6. **Clouds changing shape.** Animated noise and distance-based detail changes were morphing the clouds, so the clouds were frozen in place and the detail switch was pushed far out.
7. **Remaining boiling.** Frame-to-frame difference maps traced it to sample slices sliding with the camera, which world-anchored sampling planes fixed.
8. **Baked lighting.** The world became a seamless tile and moonlight was baked at startup, making frames cheaper while sampling got finer.
9. **Level-of-detail blending.** Spacing bands and the lighting switch now blend instead of stepping.
10. **Popping.** Softer glints, surface refinement and more cautious skipping cut large frame-to-frame jumps by about 85%.
11. **Real cloud shapes and moon.** Cumulonimbus with anvils replaced cylinder towers, cumulus became clusters of thermal bubbles, and the real lunar map replaced a noise-based moon.
12. **Colour grade.** The preset and control panel were added, with Teal Night as the default.
13. **Performance readout.** The panel gained live resolution and frame rate readouts and a resolution control.
14. **Baked cloud shape.** Rendering reads a baked copy of the cloud field plus live fine detail, about 5.5 times faster per frame with matching appearance.
15. **Lightning.** Ground strikes and in-cloud flashes from the cumulonimbus, with matching cloud, ground and sky lighting.
16. **Edge popping.** Five separate causes of cloud pieces blinking in and out were traced and fixed. Jumps larger than 64 brightness levels fell from 112 to none across the test frames, at about 15% more GPU time.
17. **Near-cloud fog.** Close clouds no longer wear a band of horizon glow.
18. **Flooded mountains.** Baked mountains, forests and lakes replaced an ocean whose waves read as a curly texture, at slightly lower cost.
19. **Stars near the horizon.** Stars now reach almost to the horizon and twinkle visibly, with a few bright low stars and a planet.
20. **Town lights.** Towns, lamp-lit roads and farmhouse lights, baked into a fifth terrain texture.
21. **Radio masts.** Masts on the two highest summits per tile, with flashing red warning lights.
22. **Film grain.** The barely visible single-pixel noise became film-style grain.
23. **Shooting stars.** Occasional meteors in the part of the sky in view, with a rate control.
24. **Lightning minimum gap.** A control for the shortest time between flashes.
25. **Video recorder.** An offline, deterministic recorder for making videos of the scene.
26. **Sound.** Synthesised wind with a whistle in the gusts, and delayed thunder after each lightning flash, with controls.
27. **Distant storms.** Silent flickers of lightning beyond the horizon, with detailed controls.
28. **Settings tabs.** The settings panel was organised into five tabs.
29. **Aircraft.** Occasional airliners on random courses, with navigation lights and a glittering moonlit contrail.

## Files

| Path | Contents |
| --- | --- |
| `index.html` | The complete scene. Three.js r128 loads from cdnjs, and everything else is inline |
| `assets/moon-lroc-512.jpg` | The lunar albedo map embedded in `index.html`, kept for reference |
| `media/flight.gif` | The clip at the top of this file |
| `tools/record.mjs` | The offline video recorder |
| `tools/example-video.json` | An example recorder configuration for a 60-second 1080p video |
| `experiments/tall-peaks.patch` | An unmerged experiment that adds two tall massifs per tile rising through the cloud deck |

## Community and support

The [Weeb Labs Discord server](https://discord.gg/RCyqxAQ5xS) is home to all of my projects, Nightscape included. Drop in to show off what you've made, ask for help, report a bug or pitch an idea. You'll usually find someone happy to dig in!

Nightscape is free to use. If you enjoy it and would like to support further work, you can donate through [Ko-fi](https://ko-fi.com/weeblabs) or [Patreon](https://patreon.com/weeblabs). The same links appear under the **Sponsor** button at the top of this repository.

## Credits

- Lunar map: NASA / GSFC Scientific Visualization Studio, CGI Moon Kit (LRO LROC data). Public domain.
- Three.js: MIT licence.
- Cities for the React app's autopilot and HUD (`app/public/cities.json`): US Census Bureau data, public domain.

## Licence

Nightscape is released under the [MIT License](LICENSE). The lunar map and Three.js keep their own terms, which are listed under [Credits](#credits).
