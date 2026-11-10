// @ts-nocheck
// Nightscape render engine: cloud raymarch -> ground -> TAA -> light shafts -> composite.
// Ported from the legacy index.html (passes, bakes, camera, adaptive scale). Lightning,
// aircraft, meteors, distant storms and sound are not ported yet (their uniforms keep
// their "off" defaults).
import * as THREE from 'three'
import {
  VERT, COMMON, BAKE_SHAPE_FRAG, BAKE_LIGHT_FRAG, SHAPE_N, SHAPE_NY, LIGHT_N, LIGHT_NY, TER_N, TER_H_FRAG, TER_L_FRAG, TER_T_FRAG,
  CLOUD_FRAG, GROUND_FRAG, RAYS_FRAG, TAA_FRAG, COMPOSITE_FRAG,
} from '../shaders/legacy'
import { buildNoise } from './noise'
import { useSettings, hexToLinear, type Clouds, type Place } from '../store/settings'
import { useHud } from '../store/hud'
import { loadCities, getCities, nearestCity, distanceM, bearing, pickNext, cityKey, type City } from '../geo/cities'
import { makeGeoRef, loadTerrainWindow, prefetchWindow, metresPerUnit, latOfPy, lonOfPx, pxOfLat, pxOfLon, WIN, REAL_TILE, UNITS_PER_PX, type GeoRef, type TerrainWindow } from '../geo/terrainWindow'

const cloudCfg = (c: Clouds) => {
  const a = (c.windDir * Math.PI) / 180
  return {
    uCover: { value: c.cover }, uCumulus: { value: c.cumulus }, uStorm: { value: c.storm }, uDeckH: { value: c.deckH },
    uWindV: { value: new THREE.Vector2(Math.cos(a) * c.windStr, Math.sin(a) * c.windStr) },
  }
}
const copyCfg = (to: ReturnType<typeof cloudCfg>, from: ReturnType<typeof cloudCfg>) => {
  to.uCover.value = from.uCover.value; to.uCumulus.value = from.uCumulus.value; to.uStorm.value = from.uStorm.value
  to.uDeckH.value = from.uDeckH.value; to.uWindV.value.copy(from.uWindV.value)
}

// layers baked per frame: while loading we can spend more of the frame, afterwards stay gentle
const SHAPE_PER_FRAME = 24, LIGHT_PER_FRAME = 4, LIGHT_PER_FRAME_LOADING = 8
const MOON_DIR = new THREE.Vector3(-0.2528, 0.2079, -0.9448).normalize()
const MOON_R = 0.044
const SPEED = 1.25
const TILE = 320
const TER_LO = -100, TER_RANGE = 52, WATER_Y = -85
const SCALE_MIN = 0.26, SCALE_MAX = 0.8
// Floating origin: when the camera strays more than ANCHOR_LIM from world 0 the world is shifted by whole
// multiples of ANCHOR_Q. 1920 = 3 x 640 (terrain tile) = 6 x 320 (cloud tile) = 500 x 3.84 (the cloud march's
// coarsest sample-plane spacing), so every baked texture and every sample plane lines up exactly afterwards.
const ANCHOR_Q = 1920, ANCHOR_LIM = 1400
// Large-scale cloud variety: cycles around the world for the two octaves of the absolute-position noise (integers,
// so the field also wraps cleanly at the date line), and how much each swells/thins the cloud (distance units).
const BIG_F1 = 51, BIG_F2 = 145
const BIG_AMP: [number, number] = [8, 5.5]
// Window look-ahead: terrain beyond ~200 units is never drawn, a window reaches 320 from its centre, so the
// camera may stray EDGE units from the centre before the edge can show. The next window is requested early
// enough (from velocity and the measured load time) and is centred ahead of travel by at most AHEAD_MAX.
const EDGE = 120, AHEAD_MAX = 130

// Autopilot over a real place. Ground speed is constant in metres/s (so it is right at any latitude) x the speed multiplier.
const AP_BASE_MS = 1800            // 1x: 1.8 km/s of ground (about 8 world units/s at 234 m/unit)
const AP_CRUISE_Y = 6.5            // just above the cloud deck
const AP_DIP_CLEAR = 13            // height above the highest ground ahead while dipping low
const AP_FLOOR = 3.2               // never closer than this to the ground ahead
const AP_YAW_RATE = 0.12           // rad/s at 1x, grows with sqrt(multiplier)
const AP_BANK_MAX = 0.22
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

const pathX = (z: number) => 4.5 * Math.sin(z * 0.019634954) + 1.6 * Math.sin(z * 0.039269908 + 1.3)
const f32 = Math.fround
const fract = (x: number) => x - Math.floor(x)
function hash12js(x: number, y: number) {
  const a = fract(f32(x * f32(0.1031))), b = fract(f32(y * f32(0.1031)))
  const k = f32(a * (b + 33.33) + b * (a + 33.33) + a * (a + 33.33))
  return fract(f32((a + k + b + k) * (a + k)))
}
let HALF_LUT: Float32Array | null = null
function halfToFloat(h: number) {
  const e = (h >> 10) & 31, m = h & 1023
  const v = e === 0 ? m * 5.960464477539063e-8 : (1 + m / 1024) * Math.pow(2, e - 15)
  return h & 0x8000 ? -v : v
}

const quadGeo = new THREE.PlaneGeometry(2, 2)
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

function makePass(frag: string, uniforms: Record<string, { value: any }>) {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false })
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(quadGeo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)
  return { mat, scene, u: uniforms }
}

export class Engine {
  renderer: THREE.WebGLRenderer
  dpr = 1
  width = 1
  height = 1
  scale = 0.5
  auto = true
  simT = 0
  tod = useSettings.getState().tod
  todSync = 0
  clock = 0
  frame = 0
  baked = false
  progress = 0 // 0..1 while baking
  ready = false
  fps = 0

  private canFloat: boolean
  private RT_TYPE: number
  private USE_TAA: boolean
  private camU: any
  private lightU: any
  private cloudPass: any; private groundPass: any; private taaPass: any; private raysPass: any; private compPass: any
  private cloudRT: THREE.WebGLRenderTarget | null = null
  private groundRT: any = null; private raysRT: any = null
  private histA: any = null; private histB: any = null; private carryHist: any = null
  // cloud volumes: shape (distance field) and lighting, each as a "from" (on screen) and "to" (being grown into)
  private shapeFrom: any; private shapeTo: any; private lightFrom: any; private lightTo: any
  private morphU = {
    uBake: { value: null as any }, uBake2: { value: null as any }, uLight: { value: null as any }, uLight2: { value: null as any }, uMorph: { value: 0 },
    uBigO: { value: new THREE.Vector4() }, uBigK: { value: new THREE.Vector2() }, uBigAmp: { value: new THREE.Vector2(BIG_AMP[0], BIG_AMP[1]) },
  }
  private morphT = -1                    // seconds into a morph, -1 when none
  private morphDur = 12
  private pending: Clouds | null = null  // a change made during a morph, baked once it ends
  private cfgFrom: ReturnType<typeof cloudCfg>
  private lastMorphUI = -1
  private shapePass: any; private lightPass: any
  private bakeActive = true; private bakeStage = 0; private bakeLayer = 0; private bakeStarted = 0
  /** Millisecond timings, filled in when the page is opened with ?timing (adds a GPU sync per step). */
  timings: Record<string, number> = {}
  private TIMING = typeof location !== 'undefined' && /[?&]timing\b/.test(location.search)
  private t0 = typeof performance !== 'undefined' ? performance.now() : 0
  private tAdd(key: string, ms: number) { this.timings[key] = Math.round(((this.timings[key] ?? 0) + ms) * 10) / 10 }
  private tMark(key: string) { if (this.timings[key] === undefined) this.timings[key] = Math.round(performance.now() - this.t0) }
  private terH: any; private terA: any; private terB: any; private terC: any; private terL: any
  private terHPass: any; private terTPass: any; private terLPass: any
  private terJobs: any[] = []
  private terJob = 0
  private terrainActive = false      // re-baking the terrain after a place change
  // terrain inputs shared by the terrain bakes and the ground pass
  private terU = {
    uTT: { value: 320 },                 // world size of the terrain tile: 320 invented, 640 real
    uUseReal: { value: 0 },
    uOrigin: { value: new THREE.Vector2() }, // the real window's centre, in tile coordinates
    uReal: { value: new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType) as THREE.Texture },
    uImg: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType) as THREE.Texture },
  }
  private terTile = 320
  private geoRef: GeoRef | null = null
  // anchor used while there is no real place, so the cloud field's absolute position keeps counting
  private virtRef = { z: 10, gx0: pxOfLon(-98, 10), gy0: pxOfLat(39, 10) }
  private pathShiftZ = 0                    // auto path: z = -simT * SPEED + pathShiftZ (kept across re-anchors)
  private lastCam = new THREE.Vector3()
  private camVel = new THREE.Vector2()      // smoothed camera velocity in world units / s (x, z)
  private loadEma = 3                       // seconds a window takes from request to ready
  private loadStart = 0
  private prefetchAt = 0
  /** Dev: multiplies flight speed (auto path, WASD, routes). */
  timeScale = 1
  reanchors = 0
  private route: any = null
  // autopilot (real places only): drives the free-fly pose `fly`, so manual takeover/handback share one pose
  private ap = {
    dest: null as City | null, visited: [] as string[], lap: false, // lap: circle the destination when reached
    orbit: 0, orbitAcc: 0, orbitPrev: 0,   // orbit: laps in progress (1 = yes), angle travelled around the city (rad)
    yawRate: 0, bank: 0, vy: 0, spd: -1, // spd: current ground speed in units/s (eases to the target; -1 = take the target)
    dipT: 0, nextDip: 70, dipping: 0,       // seconds (sim) since the last dip, when the next is due, seconds left in this dip
    hudAt: 0, drift: 0, minClear: Infinity, lastKmh: 0,
  }
  private lastDestStore: any = null
  private lastTour = false
  private lon0 = -98                        // longitude where the clock `tod` is the local solar time
  /** Dev: frame interval samples while `perfOn` (ms) and window swap events. */
  perfOn = false
  perfMs: number[] = []
  perfEvents: any[] = []
  private winOrigin = new THREE.Vector2()   // world position of the loaded real window's centre
  private winBusy = false
  private winRetryAt = 0
  private pendingWin: { win: TerrainWindow; token: number } | null = null
  private winHalf: Uint16Array | null = null
  private rhBuf: Float32Array | null = null; private rhRow = 0; private rhCol: Int32Array | null = null; private rhOx = 0; private rhOy = 0
  private terrainRolling = false            // a re-centring bake while flying (no fade)
  private lastPlace: Place | null = null
  private placeToken = 0
  private placeAbort: AbortController | null = null
  terHeights: Float32Array | null = null
  private cfgLive: ReturnType<typeof cloudCfg>
  private cfgBake: ReturnType<typeof cloudCfg>
  private rebakeTimer: any = 0
  private lastClouds: Clouds
  private pointer = { x: 0, y: 0, sx: 0, sy: 0 }
  private perfAcc = 0; private perfN = 0; private lastDrop = -1e9; private lastScaleChange = 0
  private reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  private unsub: () => void
  private onPointer: (e: PointerEvent) => void
  private onLeave: () => void
  // free-fly camera
  private manual = false
  private lastDt = 0
  private lastRaw = 0
  private fly = { x: 0, y: 3.6, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0 }
  private keys = new Set<string>()
  private dragging = false
  private onDown: (e: PointerEvent) => void
  private onUp: () => void
  private onDragMove: (e: PointerEvent) => void
  private onKeyDown: (e: KeyboardEvent) => void
  private onKeyUp: (e: KeyboardEvent) => void
  private onBlur: () => void

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    renderer.autoClear = false
    const ext = renderer.extensions
    this.canFloat = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
    this.RT_TYPE = this.canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType
    this.USE_TAA = ext.has('EXT_color_buffer_float')
    this.terU.uReal.value.unpackAlignment = 2
    this.terU.uReal.value.needsUpdate = true
    this.terU.uImg.value.needsUpdate = true
    const tn = performance.now()
    const noiseTex = buildNoise(64)
    this.timings.noiseBuildMs = Math.round(performance.now() - tn)
    const clouds0 = useSettings.getState().clouds
    this.lastClouds = clouds0
    this.cfgLive = cloudCfg(clouds0)
    this.cfgBake = cloudCfg(clouds0)
    const cfgLive = this.cfgLive
    const NOCLOUDS = /[?&]noclouds\b/.test(location.search) ? 1 : 0

    this.camU = {
      uCamPos: { value: new THREE.Vector3() }, uCamR: { value: new THREE.Vector3() },
      uCamU: { value: new THREE.Vector3() }, uCamF: { value: new THREE.Vector3() },
      uMoonDir: { value: MOON_DIR }, uTanHalf: { value: 0.5 }, uAspect: { value: 1 },
      uTime: { value: 0 }, uFrame: { value: 0 },
    }
    const camU = this.camU
    // 3D render targets the bakes draw into one layer at a time (no CPU readback)
    const mk3 = (n: number, nz: number, format: number) => {
      const rt = new THREE.WebGL3DRenderTarget(n, n, nz, {
        format, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      })
      rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping
      rt.texture.wrapR = THREE.ClampToEdgeWrapping
      return rt
    }
    this.shapeFrom = mk3(SHAPE_N, SHAPE_NY, THREE.RedFormat); this.shapeTo = mk3(SHAPE_N, SHAPE_NY, THREE.RedFormat)
    this.lightFrom = mk3(LIGHT_N, LIGHT_NY, THREE.RGFormat); this.lightTo = mk3(LIGHT_N, LIGHT_NY, THREE.RGFormat)
    this.syncVolumes()
    this.cfgFrom = cloudCfg(clouds0)
    this.morphDur = clouds0.speed

    const V3 = () => new THREE.Vector3()
    this.lightU = {
      uFlash: { value: 0 }, uLR2: { value: 0 },
      uLa0: { value: V3() }, uLb0: { value: V3() }, uLi0: { value: 0 },
      uLa1: { value: V3() }, uLb1: { value: V3() }, uLi1: { value: 0 },
      uGround: { value: V3() }, uGroundI: { value: 0 },
    }
    const makeTerRT = (type: number) => {
      const rt = new THREE.WebGLRenderTarget(TER_N, TER_N, {
        type, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: true,
      })
      rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping
      return rt
    }
    const hf = this.canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType
    this.terH = makeTerRT(hf); this.terA = makeTerRT(THREE.UnsignedByteType)
    this.terB = makeTerRT(THREE.UnsignedByteType); this.terC = makeTerRT(THREE.UnsignedByteType)
    this.terL = makeTerRT(hf)
    const PACK = this.USE_TAA ? '#define PACK 1\n' : ''
    this.cloudPass = makePass(PACK + CLOUD_FRAG, Object.assign({
      uNoise: { value: noiseTex }, uNoClouds: { value: NOCLOUDS }, uDensity: { value: clouds0.density },
    }, camU, this.lightU, cfgLive, this.morphU))
    this.groundPass = makePass(PACK + GROUND_FRAG, Object.assign({
      uNoise: { value: noiseTex }, tCloud: { value: null },
      uTerH: { value: this.terH.texture }, uTerA: { value: this.terA.texture }, uTerB: { value: this.terB.texture },
      uTerC: { value: this.terC.texture }, uTerL: { value: this.terL.texture }, uLamps: { value: 1 },
      uMast: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uMastN: { value: 0 },
      uTerTop: { value: -50 }, uPixAngC: { value: 0.001 }, uNoClouds: { value: NOCLOUDS },
    }, camU, this.lightU, cfgLive, this.morphU, this.terU))
    this.taaPass = makePass(TAA_FRAG, {
      tCur: { value: null }, tHist: { value: null }, uSize: { value: new THREE.Vector2() },
      uCamPos: camU.uCamPos, uCamR: camU.uCamR, uCamU: camU.uCamU, uCamF: camU.uCamF,
      uTanHalf: camU.uTanHalf, uAspect: camU.uAspect,
      uPrevPos: { value: V3() }, uPrevR: { value: V3() }, uPrevU: { value: V3() }, uPrevF: { value: V3() },
      uPrevTanHalf: { value: 0.5 }, uPrevAspect: { value: 1 }, uReset: { value: 1 },
    })
    this.raysPass = makePass(RAYS_FRAG, {
      tCloud: { value: null }, uMoonUV: { value: new THREE.Vector2() }, uAspect: camU.uAspect,
      uMoonRuv: { value: 0.05 }, uFrame: camU.uFrame, uFade: { value: 0 }, uLumW: { value: 0.5 },
    })
    this.compPass = makePass(COMPOSITE_FRAG, Object.assign({
      tCloud: { value: null }, tRays: { value: null }, uNoise: { value: noiseTex },
      uCloudTexel: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() },
      uPixAng: { value: 0.001 }, uMoonR: { value: MOON_R }, uExposure: { value: 1.12 },
      uTwinkle: { value: 1 }, uStarLow: { value: 0.035 },
      uMetA: { value: new THREE.Vector3(0, 0, 1) }, uMetB: { value: new THREE.Vector3(0, 0.1, 1) }, uMet: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMoonMap: { value: null }, uMoonReady: { value: 0 }, uMoonPhase: { value: 0.5 },
      uBalance: { value: new THREE.Vector3(1, 1, 1) }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
      uHighTint: { value: new THREE.Vector3(1, 1, 1) }, uShadowAmt: { value: 0 }, uHighAmt: { value: 0 },
      uLift: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.38 },
      uGrain: { value: 0.007 }, uRays: { value: 1 },
      tBolt: { value: null }, uBoltOn: { value: 0 }, uSkyFlash: { value: V3() }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
      uFar: { value: new THREE.Vector4(0, 0, -1, 0) }, uFarShape: { value: new THREE.Vector3(0.1, 0, 0.04) }, uFarCol: { value: new THREE.Vector4(1, 0.84, 0.74, 1) },
      uSunDir: { value: new THREE.Vector3(1, -1, 0) }, uDayAmt: { value: 0 }, uNightAmt: { value: 1 }, uTwi: { value: 0 }, uDayLift: { value: new THREE.Vector3(1, 1, 1) },
      uAirOn: { value: 0 }, uAirW: { value: new THREE.Vector3(0, 1, 0) }, uAirR: { value: new THREE.Vector3(0, 1, 0) }, uAirG: { value: new THREE.Vector3(0, 1, 0) },
      uAirI: { value: V3() }, uConA: { value: V3() }, uConB: { value: V3() }, uCon: { value: new THREE.Vector4(0, 0, 150, 0) }, uGlitter: { value: 1 },
    }, camU, cfgLive))

    // the ground is lit by the sun itself in daytime, with the same sun the sky uses
    for (const k of ['uSunDir', 'uDayAmt', 'uTwi', 'uDayLift']) { this.groundPass.u[k] = this.compPass.u[k]; this.cloudPass.u[k] = this.compPass.u[k] }

    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}moon-lroc-512.jpg`, (tex) => {
      tex.wrapS = THREE.RepeatWrapping
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      tex.needsUpdate = true
      this.compPass.u.uMoonMap.value = tex
      this.compPass.u.uMoonReady.value = 1
    })

    // bakes
    this.shapePass = makePass(BAKE_SHAPE_FRAG, Object.assign({ uNoise: { value: noiseTex }, uLayer: { value: 0 } }, this.cfgBake))
    this.lightPass = makePass(BAKE_LIGHT_FRAG, Object.assign({ uNoise: { value: noiseTex }, uMoonDir: { value: MOON_DIR }, uLayer: { value: 0 } }, this.cfgBake))
    this.bakeStarted = performance.now()
    this.terHPass = makePass(TER_H_FRAG, Object.assign({ uNoise: { value: noiseTex } }, this.terU, cfgLive))
    this.terTPass = makePass(TER_T_FRAG, Object.assign({ uNoise: { value: noiseTex }, uTerH: { value: this.terH.texture }, uZ: { value: 0 } }, this.terU, cfgLive))
    this.terLPass = makePass(TER_L_FRAG, Object.assign({ uNoise: { value: noiseTex }, uTerH: { value: this.terH.texture }, uMoonDir: { value: MOON_DIR }, uMode: { value: 0 } }, this.terU, cfgLive))
    const J = this.terJobs
    for (let s = 0; s < 4; s++) J.push({ rt: this.terH, pass: this.terHPass, s, n: 4, label: 'H' })
    for (let s = 0; s < 8; s++) J.push({ rt: this.terA, pass: this.terLPass, mode: 0, s, n: 8, label: 'A' })
    for (let s = 0; s < 2; s++) J.push({ rt: this.terB, pass: this.terLPass, mode: 1, s, n: 2, label: 'B' })
    for (let s = 0; s < 4; s++) J.push({ rt: this.terC, pass: this.terLPass, mode: 2, s, n: 4, label: 'C' })
    for (let s = 0; s < 8; s++) J.push({ rt: this.terL, pass: this.terTPass, s, n: 8, label: 'T' })

    this.onPointer = (e) => {
      if ((e.target as HTMLElement)?.closest?.('[data-ui]')) return
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    this.onLeave = () => { this.pointer.x = 0; this.pointer.y = 0 }
    window.addEventListener('pointermove', this.onPointer)
    document.addEventListener('pointerleave', this.onLeave)

    const isUI = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.('[data-ui]')
    const isField = (t: EventTarget | null) => /^(INPUT|TEXTAREA|SELECT)$/.test((t as HTMLElement)?.tagName ?? '')
    this.onDown = (e) => { if (e.button === 0 && !isUI(e.target)) { this.dragging = true; if (!this.route?.lock) this.route = null; this.setManual(true) } }
    this.onUp = () => { this.dragging = false }
    this.onDragMove = (e) => {
      if (!this.dragging || !this.manual) return
      const f = this.fly
      f.yaw -= e.movementX * 0.003 // grab the world: drag right, the view turns left
      f.pitch = THREE.MathUtils.clamp(f.pitch + e.movementY * 0.003, -1.5, 1.5)
    }
    this.onKeyDown = (e) => {
      if (isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if ('wasdqe'.includes(k) && k.length === 1) { this.keys.add(k); if (!this.route?.lock) this.route = null; this.setManual(true); e.preventDefault() }
      else if (k === 'shift') this.keys.add('shift')
      else if (k === 'r') this.setManual(false)
    }
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase())
    this.onBlur = () => { this.keys.clear(); this.dragging = false }
    window.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)
    window.addEventListener('pointermove', this.onDragMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)

    this.applyGrade()
    void loadCities().catch(() => {})
    this.unsub = useSettings.subscribe((st) => {
      if (st.manual !== this.manual) this.setManual(st.manual)
      if (st.tour !== this.lastTour) { this.lastTour = st.tour; if (st.tour && this.geoRef) { const ll = this.llAt(this.fly.x, this.fly.z); this.pickDestination(ll.lat, ll.lon) } }
      if (st.dest !== this.lastDestStore) { this.lastDestStore = st.dest; if (st.dest) this.setDestination(st.dest as City, true) }
      this.applyGrade()
      if (st.tod !== this.tod) this.tod = st.tod // moved from the panel
      if (st.place !== this.lastPlace) { const p = st.place; this.lastPlace = p; void this.loadPlace(p) }
      if (st.clouds !== this.lastClouds) { const c = st.clouds, p = this.lastClouds; this.lastClouds = c; this.onCloudsChanged(c, p) }
    })
  }

  dispose() {
    window.removeEventListener('pointermove', this.onPointer)
    document.removeEventListener('pointerleave', this.onLeave)
    window.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    window.removeEventListener('pointermove', this.onDragMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.unsub?.()
    clearTimeout(this.rebakeTimer)
    ;[this.cloudRT, this.groundRT, this.raysRT, this.histA, this.histB, this.carryHist,
      this.terH, this.terA, this.terB, this.terC, this.terL, this.shapeFrom, this.shapeTo, this.lightFrom, this.lightTo].forEach((r) => r?.dispose())
    for (const p of [this.cloudPass, this.groundPass, this.taaPass, this.raysPass, this.compPass, this.terHPass, this.terTPass, this.terLPass, this.shapePass, this.lightPass]) p?.mat.dispose()
  }

  private onCloudsChanged(c: Clouds, prev: Clouds) {
    this.cloudPass.u.uDensity.value = c.density // live
    this.morphDur = c.speed // live
    const shape = c.cover !== prev.cover || c.cumulus !== prev.cumulus || c.storm !== prev.storm || c.deckH !== prev.deckH || c.windDir !== prev.windDir || c.windStr !== prev.windStr
    if (!shape) return
    clearTimeout(this.rebakeTimer)
    // wait for the slider to settle, then bake the new shape in the background
    this.rebakeTimer = setTimeout(() => {
      if (this.morphT >= 0 || this.bakeActive) { this.pending = c; return } // finish the change in progress first
      this.startBake(c)
    }, 350)
  }

  /** Upload a real window and start baking the terrain from it. */
  private applyWindow(win: TerrainWindow, rolling: boolean) {
    const ref = this.geoRef!
    const mk = (data: any, fmt: number, type: number, align: number) => {
      const t = new THREE.DataTexture(data, WIN, WIN, fmt, type)
      t.minFilter = t.magFilter = THREE.LinearFilter
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      t.unpackAlignment = align
      t.needsUpdate = true
      return t
    }
    this.terU.uReal.value.dispose(); this.terU.uImg.value.dispose()
    this.winHalf = win.half; this.rhBuf = null
    this.terU.uReal.value = mk(win.half, THREE.RedFormat, THREE.HalfFloatType, 2)
    this.terU.uImg.value = mk(win.rgba, THREE.RGBAFormat, THREE.UnsignedByteType, 1)
    // where the window's centre sits in the world (and so in the repeating terrain tile)
    this.winOrigin.set((win.cx - ref.gx0) * UNITS_PER_PX, (win.cy - ref.gy0) * UNITS_PER_PX)
    this.terU.uOrigin.value.set(this.winOrigin.x / REAL_TILE, this.winOrigin.y / REAL_TILE)
    this.terU.uUseReal.value = 1
    this.updateBigField()
    this.terU.uTT.value = this.terTile = REAL_TILE
    this.terJob = 0
    this.terrainActive = true
    this.terrainRolling = rolling
    if (rolling) this.timings.windowSwaps = (this.timings.windowSwaps ?? 0) + 1
  }

  /** Load a real place (or go back to the invented mountains) and re-bake the terrain under a fade to black. */
  private async loadPlace(p: Place | null) {
    const token = ++this.placeToken
    this.placeAbort?.abort()
    this.pendingWin = null; this.winBusy = false
    const S = useSettings
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    if (!this.baked) return // the saved place is started once the first bake is done
    S.setState({ fade: 1, placeStatus: p ? 'loading' : 'idle', placeInfo: '' })
    const t0 = performance.now()
    try {
      if (!p) {
        await sleep(450)
        if (token !== this.placeToken) return
        this.geoRef = null
        this.updateBigField()
        this.terU.uUseReal.value = 0
        this.terU.uTT.value = this.terTile = 320
        this.terJob = 0
        this.terrainActive = true; this.terrainRolling = false
      } else {
        this.placeAbort = new AbortController()
        const ref = makeGeoRef(p.lat, p.lon)
        const win = await loadTerrainWindow(ref, Math.round(ref.gx0), Math.round(ref.gy0), this.placeAbort.signal)
        if (token !== this.placeToken) return
        await sleep(Math.max(0, 450 - (performance.now() - t0))) // let the fade finish
        if (token !== this.placeToken) return
        this.geoRef = ref
        this.applyWindow(win, false)
        const lo = Math.round(win.minElev), hi = Math.round(win.maxElev)
        S.setState({ placeInfo: `${Math.round(ref.windowKm)} km wide view, ${lo} to ${hi} m, relief drawn ${ref.exaggeration.toFixed(1)}x taller than true` })
      }
      this.simT = 0 // start the flight over the middle of the place
      this.pathShiftZ = 0
      this.route = null
      if (p) {
        // start over the middle of the place: the free-fly pose is the autopilot's too
        const f = this.fly
        f.x = 0; f.z = 0; f.vx = f.vy = f.vz = 0; f.y = AP_CRUISE_Y; f.pitch = -0.07
        this.lon0 = p.lon
        const a = this.ap
        a.dest = null; a.visited = []; a.orbit = 0; a.yawRate = 0; a.bank = 0; a.vy = 0; a.spd = -1; a.dipT = 0; a.dipping = 0; a.minClear = Infinity
        S.setState({ dest: null }); this.lastDestStore = null
        this.pickDestination(p.lat, p.lon)
        if (a.dest) f.yaw = bearing(p.lat, p.lon, a.dest.lat, a.dest.lon)
      }
      this.camVel.set(0, 0); this.lastCam.copy(this.camU.uCamPos.value)
    } catch (e: any) {
      if (token !== this.placeToken || e?.name === 'AbortError') return
      S.setState({ placeStatus: 'error', placeInfo: String(e?.message ?? e), fade: 0 })
    }
  }

  private anchor() { return this.geoRef ?? this.virtRef }

  /** Ground metres that one world unit stands for at the camera (Mercator stretches the map by 1/cos(lat)). */
  groundMPerUnit() { const A = this.anchor(); return metresPerUnit(A.gy0 + this.camU.uCamPos.value.z / UNITS_PER_PX, A.z) }
  /** Camera latitude / longitude, degrees. */
  camLatLon() {
    const A = this.anchor(), c = this.camU.uCamPos.value
    return { lat: latOfPy(A.gy0 + c.z / UNITS_PER_PX, A.z), lon: lonOfPx(A.gx0 + c.x / UNITS_PER_PX, A.z) }
  }

  /**
   * Cloud-field phase for the camera's absolute position. Mercator pixels / (2^z * 256) is the same number at any zoom,
   * so the field belongs to the Earth, not to a window. The phases are reduced in double precision here: the
   * shader only ever adds a small local offset to a number in 0..1.
   */
  private updateBigField() {
    const A = this.anchor(), W = 2 ** A.z * 256
    const mx = A.gx0 / W, my = A.gy0 / W
    const fr = (v: number) => v - Math.floor(v)
    const u = this.morphU
    u.uBigO.value.set(fr(mx * BIG_F1), fr(my * BIG_F1), fr(mx * BIG_F2), fr(my * BIG_F2))
    const perUnit = 1 / (UNITS_PER_PX * W)
    u.uBigK.value.set(BIG_F1 * perUnit, BIG_F2 * perUnit)
  }

  /** Shift the world by (sx, sz) (multiples of ANCHOR_Q) so the camera is back near 0. Invisible by construction. */
  private reanchor(sx: number, sz: number) {
    const A = this.anchor()
    A.gx0 += sx / UNITS_PER_PX; A.gy0 += sz / UNITS_PER_PX
    if (this.geoRef) {
      this.winOrigin.x -= sx; this.winOrigin.y -= sz
      this.terU.uOrigin.value.set(this.winOrigin.x / REAL_TILE, this.winOrigin.y / REAL_TILE) // a whole number of tiles different: same fract()
    }
    this.fly.x -= sx; this.fly.z -= sz
    this.pathShiftZ -= sz
    const sub = (v: THREE.Vector3) => { v.x -= sx; v.z -= sz }
    sub(this.camU.uCamPos.value); sub(this.taaPass.u.uPrevPos.value); sub(this.lastCam)
    this.updateBigField()
    this.reanchors++
    if (this.perfOn) this.perfEvents.push({ t: this.clock, frame: this.frame, kind: 'reanchor', sx, sz })
  }

  private maybeReanchor() {
    const c = this.camU.uCamPos.value
    const sx = Math.abs(c.x) > ANCHOR_LIM ? Math.round(c.x / ANCHOR_Q) * ANCHOR_Q : 0
    const sz = Math.abs(c.z) > ANCHOR_LIM ? Math.round(c.z / ANCHOR_Q) * ANCHOR_Q : 0
    if (sx || sz) this.reanchor(sx, sz)
  }

  private trackVelocity(raw: number) {
    const c = this.camU.uCamPos.value
    if (raw > 0 && this.frame > 2) {
      const dt = Math.min(raw, 0.25), a = 1 - Math.exp(-dt / 0.35)
      this.camVel.x += ((c.x - this.lastCam.x) / dt - this.camVel.x) * a
      this.camVel.y += ((c.z - this.lastCam.z) / dt - this.camVel.y) * a
    }
    this.lastCam.copy(c)
  }

  /**
   * While flying over a real place, fetch a fresh window before the edge of the loaded one can come into view, and
   * bake it in quietly. The world-to-map mapping is the same, so the terrain already on screen does not change and
   * the land just keeps going. The request is timed from the camera velocity and the measured load time, and the
   * window is centred ahead of travel (so it lasts longer). While it is not due, the tiles it will need are prefetched.
   */
  private updateRolling() {
    const ref = this.geoRef
    if (!ref || this.terrainActive) return
    const now = performance.now()
    if (this.pendingWin) {
      const w = this.pendingWin
      this.pendingWin = null; this.winBusy = false
      this.loadEma = 0.6 * this.loadEma + 0.4 * Math.min((now - this.loadStart) / 1000, 20)
      if (w.token === this.placeToken) {
        this.applyWindow(w.win, true)
        if (this.perfOn) this.perfEvents.push({ t: this.clock, frame: this.frame, kind: 'window', loadMs: Math.round(now - this.loadStart) })
      }
      return
    }
    if (this.winBusy || now < this.winRetryAt) return
    const c = this.camU.uCamPos.value, v = this.camVel, wo = this.winOrigin
    const lead = Math.min(this.loadEma * 1.4 + 0.8, 14) // seconds between the request and the window being ready
    const MARGIN = 8
    // d = camera offset from the window centre. Moving: only the edge ahead matters (it must stay out of view for
    // `lead` more seconds), while the window may trail behind the camera by up to AHEAD_MAX + 20. At rest: either edge.
    const due = (d: number, vel: number) => Math.abs(vel) < 2
      ? Math.abs(d) > EDGE - MARGIN
      : (vel > 0 ? EDGE - d : EDGE + d) < Math.abs(vel) * lead + MARGIN || Math.abs(d) > EDGE + AHEAD_MAX + 20
    const ahead = (vel: number) => Math.max(-AHEAD_MAX, Math.min(AHEAD_MAX, vel * (lead + 3)))
    const cx = Math.round(ref.gx0 + (c.x + ahead(v.x)) / UNITS_PER_PX), cy = Math.round(ref.gy0 + (c.z + ahead(v.y)) / UNITS_PER_PX)
    if (!(due(c.x - wo.x, v.x) || due(c.z - wo.y, v.y))) {
      if (Math.hypot(v.x, v.y) > 0.5 && now > this.prefetchAt) { this.prefetchAt = now + 1500; prefetchWindow(ref, cx, cy, this.placeAbort?.signal) }
      return
    }
    this.winBusy = true; this.loadStart = now
    const token = this.placeToken
    loadTerrainWindow(ref, cx, cy, this.placeAbort?.signal)
      .then((win) => { if (token === this.placeToken) this.pendingWin = { win, token }; else this.winBusy = false })
      .catch(() => { this.winBusy = false; this.winRetryAt = performance.now() + 5000 })
  }

  private onTerrainDone() {
    if (this.terrainRolling) { this.terrainRolling = false; return } // a quiet re-centring: nothing to show
    this.taaPass.u.uReset.value = 1 // the view jumped: do not blend with the old place
    useSettings.setState((s) => ({ fade: 0, placeStatus: s.place ? 'ready' : 'idle' }))
  }

  private startBake(c: Clouds) {
    this.pending = null
    copyCfg(this.cfgBake, cloudCfg(c))
    this.bakeActive = true; this.bakeStage = 0; this.bakeLayer = 0
    this.bakeStarted = performance.now()
  }

  /** Point the shader uniforms at the current from/to volumes. */
  private syncVolumes() {
    this.morphU.uBake.value = this.shapeFrom.texture; this.morphU.uBake2.value = this.shapeTo.texture
    this.morphU.uLight.value = this.lightFrom.texture; this.morphU.uLight2.value = this.lightTo.texture
  }

  applyGrade() {
    const g = useSettings.getState().grade
    const u = this.compPass.u
    u.uExposure.value = g.exposure
    const t = g.temp, tn = g.tint
    const b = [(1 + 0.28 * t) * (1 - 0.08 * tn), 1 + 0.16 * tn, (1 - 0.28 * t) * (1 - 0.08 * tn)]
    const l = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2]
    u.uBalance.value.set(b[0] / l, b[1] / l, b[2] / l)
    hexToLinear(g.shadow, u.uShadowTint.value)
    hexToLinear(g.high, u.uHighTint.value)
    u.uShadowAmt.value = g.shadowAmt; u.uHighAmt.value = g.highAmt
    u.uLift.value = g.lift; u.uSat.value = g.sat; u.uContrast.value = g.contrast
    u.uVignette.value = g.vignette; u.uGrain.value = g.grain; u.uRays.value = g.rays
    u.uMoonPhase.value = useSettings.getState().moonPhase
  }

  /** Sun position and day/night weights from the time of day (6 = sunrise in the east, 12 = high noon, 18 = sunset). */
  applySun() {
    const phi = ((this.localHour(this.camLatLon().lon) - 6) / 12) * Math.PI
    const u = this.compPass.u
    const sy = Math.sin(phi)
    u.uSunDir.value.set(Math.cos(phi), sy * 0.9, -0.5 * sy).normalize()
    const y = u.uSunDir.value.y
    const sm = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
    const day = sm(-0.18, 0.1, y)
    u.uDayAmt.value = day
    u.uNightAmt.value = 1 - sm(-0.2, -0.02, y)
    u.uTwi.value = 1 - sm(0.0, 0.4, Math.abs(y + 0.04))
    // what the composite multiplies the baked light by in daytime (warm and dim near the horizon)
    const sunUp = sm(0.0, 0.4, y), gain = 14 * (0.2 + 0.8 * sunUp)
    u.uDayLift.value.set(gain * 1.0, gain * (0.55 + 0.42 * sunUp), gain * (0.32 + 0.60 * sunUp))
    this.groundPass.u.uLamps.value = 1 - 0.95 * sm(-0.1, 0.12, y)
  }

  /** Called when the canvas size or pixel ratio changes. */
  resize(w: number, h: number, dpr: number) {
    this.width = w; this.height = h; this.dpr = dpr
    this.resizeTargets()
  }

  private makeRT(w: number, h: number, type?: number, filter?: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: type ?? this.RT_TYPE, format: THREE.RGBAFormat, minFilter: filter ?? THREE.LinearFilter, magFilter: filter ?? THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    })
  }

  private resizeTargets() {
    const w = this.width, h = this.height
    const cw = Math.max(64, Math.round(w * this.scale)), ch = Math.max(64, Math.round(h * this.scale))
    if (this.cloudRT) { this.cloudRT.dispose(); this.groundRT.dispose(); this.raysRT.dispose() }
    if (this.carryHist) this.carryHist.dispose()
    this.carryHist = this.histA || null
    if (this.histB) this.histB.dispose()
    this.histA = this.histB = null
    if (this.USE_TAA) {
      this.cloudRT = this.makeRT(cw, ch, THREE.FloatType, THREE.NearestFilter)
      this.groundRT = this.makeRT(cw, ch, THREE.FloatType, THREE.NearestFilter)
      this.histA = this.makeRT(cw, ch); this.histB = this.makeRT(cw, ch)
      this.taaPass.u.uSize.value.set(cw, ch)
      if (!this.carryHist) this.taaPass.u.uReset.value = 1
    } else {
      this.cloudRT = this.makeRT(cw, ch)
      this.groundRT = this.makeRT(cw, ch)
    }
    this.raysRT = this.makeRT(Math.max(32, Math.round(cw * 0.5)), Math.max(32, Math.round(ch * 0.5)))
    this.compPass.u.uCloudTexel.value.set(this.USE_TAA ? 0 : 1 / cw, this.USE_TAA ? 0 : 1 / ch)
  }

  // ---- baking: a few layers per frame, straight into 3D render targets ----
  private bakeStep() {
    const r = this.renderer, gl = r.getContext(), first = !this.baked
    const shapeRT = first ? this.shapeFrom : this.shapeTo
    const lightRT = first ? this.lightFrom : this.lightTo
    const t = this.TIMING ? performance.now() : 0
    const stage = this.bakeStage
    if (stage === 0) {
      for (let i = 0; i < SHAPE_PER_FRAME && this.bakeLayer < SHAPE_NY; i++) {
        this.shapePass.u.uLayer.value = this.bakeLayer
        r.setRenderTarget(shapeRT, this.bakeLayer++)
        r.render(this.shapePass.scene, quadCam)
      }
      if (this.bakeLayer >= SHAPE_NY) { this.bakeStage = 1; this.bakeLayer = 0 }
    } else {
      const per = first ? LIGHT_PER_FRAME_LOADING : LIGHT_PER_FRAME
      for (let i = 0; i < per && this.bakeLayer < LIGHT_NY; i++) {
        this.lightPass.u.uLayer.value = this.bakeLayer
        r.setRenderTarget(lightRT, this.bakeLayer++)
        r.render(this.lightPass.scene, quadCam)
      }
    }
    if (this.TIMING) {
      gl.finish()
      const ms = performance.now() - t, key = stage === 0 ? 'bakeShape' : 'bakeLight'
      if (this.timings[key + 'FirstStepMs'] === undefined) this.timings[key + 'FirstStepMs'] = Math.round(ms)
      this.tAdd(key + 'Ms', ms)
    }
    const done = stage === 1 && this.bakeLayer >= LIGHT_NY
    const frac = this.bakeStage === 0 ? (0.1 * this.bakeLayer) / SHAPE_NY : 0.1 + (0.9 * this.bakeLayer) / LIGHT_NY
    this.progress = frac * 0.6
    if (!first) useSettings.setState({ rebake: done ? -1 : frac })
    if (done) this.finishBake()
  }

  private finishBake() {
    this.bakeActive = false
    this.renderer.setRenderTarget(null)
    if (this.baked) {
      // keep the old shape on screen and grow into the new one
      this.timings.lastRebakeMs = Math.round(performance.now() - this.bakeStarted)
      copyCfg(this.cfgFrom, this.cfgLive)
      this.morphT = 0
      this.morphU.uMorph.value = 0.0001
      useSettings.setState({ rebake: -1, morph: 0 })
    } else {
      this.tMark('cloudBakeDoneAt')
      copyCfg(this.cfgLive, this.cfgBake)
      copyCfg(this.cfgFrom, this.cfgLive)
    }
  }

  private terrainStep(): boolean {
    const r = this.renderer
    if (this.terJob < this.terJobs.length) {
      const j = this.terJobs[this.terJob++], h = TER_N / j.n
      if (j.mode !== undefined) this.terLPass.u.uMode.value = j.mode
      j.rt.scissor.set(0, j.s * h, TER_N, h)
      j.rt.scissorTest = true
      r.setRenderTarget(j.rt)
      const tj = performance.now()
      r.render(j.pass.scene, quadCam)
      this.tAdd('terrain_' + j.label + '_cpuMs', performance.now() - tj)
      if (this.TIMING) { const g = r.getContext(); const t = performance.now(); g.finish(); this.tAdd('terrainSyncMs', performance.now() - t) }
      this.progress = 0.6 + 0.4 * (this.terJob / this.terJobs.length)
      return false
    }
    // scissor off so the targets render fully afterwards
    for (const rt of [this.terH, this.terA, this.terB, this.terC, this.terL]) rt.scissorTest = false
    if (this.terrainRolling && this.winHalf) return this.rollHeights()
    const half = this.terH.texture.type === THREE.HalfFloatType
    const buf = half ? new Uint16Array(TER_N * TER_N * 4) : new Uint8Array(TER_N * TER_N * 4)
    r.readRenderTargetPixels(this.terH, 0, 0, TER_N, TER_N, buf)
    const H = (this.terHeights = new Float32Array(TER_N * TER_N))
    let top = -1e9
    for (let i = 0; i < TER_N * TER_N; i++) {
      const v = half ? halfToFloat(buf[i * 4]) : buf[i * 4] / 255
      const y = TER_LO + v * TER_RANGE
      H[i] = y; if (y > top) top = y
    }
    this.groundPass.u.uTerTop.value = top + 0.3
    this.placeMasts()
    r.setRenderTarget(null)
    return true
  }

  /**
   * Heights for the CPU (camera ground clamp, mast spots) after a rolling window swap. A GPU read-back of the baked
   * height target stalls a frame for ~45 ms, so the same heights are rebuilt from the window's own elevation data
   * instead (without the fine noise and lake carving, which the camera clamp does not need), 128 rows per frame.
   */
  private rollHeights(): boolean {
    const N = TER_N
    if (!this.rhBuf) {
      if (!HALF_LUT) { HALF_LUT = new Float32Array(65536); for (let i = 0; i < 65536; i++) HALF_LUT[i] = halfToFloat(i) }
      this.rhBuf = new Float32Array(N * N); this.rhRow = 0
      const o = this.terU.uOrigin.value, fr = (v: number) => v - Math.floor(v)
      this.rhCol = new Int32Array(N)
      for (let i = 0; i < N; i++) this.rhCol[i] = Math.min(N - 1, Math.floor(fr((i + 0.5) / N - o.x + 0.5) * N))
      this.rhOx = o.x; this.rhOy = o.y
    }
    const fr = (v: number) => v - Math.floor(v), half = this.winHalf!, H = this.rhBuf, col = this.rhCol!
    const end = Math.min(N, this.rhRow + 128)
    for (let j = this.rhRow; j < end; j++) {
      const wj = Math.min(N - 1, Math.floor(fr((j + 0.5) / N - this.rhOy + 0.5) * N)) * N
      for (let i = 0; i < N; i++) H[j * N + i] = TER_LO + HALF_LUT![half[wj + col[i]]] * TER_RANGE
    }
    this.rhRow = end
    if (end < N) return false
    let top = -1e9
    for (let i = 0; i < N * N; i++) if (H[i] > top) top = H[i]
    this.terHeights = H
    this.rhBuf = null
    this.groundPass.u.uTerTop.value = top + 0.7
    this.placeMasts()
    this.renderer.setRenderTarget(null)
    return true
  }

  private placeMasts() {
    const Hh = this.terHeights!
    const B = 16, NB = TER_N / B, bh = new Float32Array(NB * NB), bi = new Int32Array(NB * NB)
    bh.fill(-1e9)
    for (let j = 0; j < TER_N; j++) for (let i = 0; i < TER_N; i++) {
      const k = ((j / B) | 0) * NB + ((i / B) | 0), y = Hh[j * TER_N + i]
      if (y > bh[k]) { bh[k] = y; bi[k] = j * TER_N + i }
    }
    const peaks: { i: number; y: number }[] = []
    for (let bj = 0; bj < NB; bj++) for (let bx = 0; bx < NB; bx++) {
      const y = bh[bj * NB + bx]
      if (y < WATER_Y + 14) continue
      let top = true
      for (let dj = -2; dj <= 2 && top; dj++) for (let di = -2; di <= 2; di++) {
        if (!di && !dj) continue
        if (bh[((bj + dj + NB) % NB) * NB + ((bx + di + NB) % NB)] > y) { top = false; break }
      }
      if (top) peaks.push({ i: bi[bj * NB + bx], y })
    }
    peaks.sort((a, b) => b.y - a.y)
    const f = this.terTile / TER_N, picked: { x: number; z: number; y: number }[] = []
    const TT = this.terTile
    const wrap = (d: number) => ((((d + TT / 2) % TT) + TT) % TT) - TT / 2
    for (const p of peaks) {
      if (picked.length >= 2) break
      const x = ((p.i % TER_N) + 0.5) * f, z = (((p.i / TER_N) | 0) + 0.5) * f
      if (picked.some((q) => Math.hypot(wrap(x - q.x), wrap(z - q.z)) < 45)) continue
      picked.push({ x, z, y: p.y })
    }
    picked.forEach((p, k) => this.groundPass.u.uMast.value[k].set(p.x, p.z, p.y - 0.1, hash12js(k * 7.3 + 1.1, 3.7)))
    this.groundPass.u.uMastN.value = picked.length
  }

  /** Ground or water surface height at world (x, z). */
  surfaceY(x: number, z: number) {
    const H = this.terHeights
    if (!H) return WATER_Y
    const f = TER_N / this.terTile
    const u = ((((x * f - 0.5) % TER_N) + TER_N) % TER_N), v = ((((z * f - 0.5) % TER_N) + TER_N) % TER_N)
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0
    const i1 = (i0 + 1) % TER_N, j1 = (j0 + 1) % TER_N
    const y = (H[j0 * TER_N + i0] * (1 - fu) + H[j0 * TER_N + i1] * fu) * (1 - fv) + (H[j1 * TER_N + i0] * (1 - fu) + H[j1 * TER_N + i1] * fu) * fv
    return Math.max(y, WATER_Y)
  }

  // ---- camera ----
  private _f = new THREE.Vector3(); private _r = new THREE.Vector3(); private _u = new THREE.Vector3(); private _up = new THREE.Vector3()
  /** Switch between the automatic path and free flight, continuing from where the camera is. */
  private setManual(on: boolean) {
    if (on === this.manual) return
    if (!on && this.route?.lock) return
    this.manual = on
    const f = this.fly
    if (on) {
      this.camVel.set(0, 0)
      const p = this.camU.uCamPos.value, d = this.camU.uCamF.value
      f.x = p.x; f.y = p.y; f.z = p.z
      f.yaw = Math.atan2(d.x, -d.z); f.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))
      if (!this.geoRef) f.vx = f.vy = f.vz = 0 // on a real place the autopilot's velocity carries over and eases out
    } else if (this.geoRef) {
      // autopilot takes over from the current position and heading: nothing to snap, the heading eases to the route
      this.route = null
      this.keys.clear(); this.dragging = false
      this.ap.vy = f.vy; this.ap.yawRate = 0; this.ap.spd = Math.hypot(f.vx, f.vz) // speed up from where manual flight left off
    } else {
      this.simT = -f.z / SPEED // rejoin the path at the current point along it
      this.pathShiftZ = 0
      this.route = null
      this.keys.clear(); this.dragging = false
      this.taaPass.u.uReset.value = 1
    }
    if (useSettings.getState().manual !== on) useSettings.setState({ manual: on })
  }

  /** Dev autopilot: fly straight (in map space) to the next waypoint at `speed` units/s x timeScale. */
  private stepRoute(dt: number) {
    const f = this.fly, r = this.route, A = this.anchor()
    const tgt = r.pts[r.i]
    const dx = (tgt.x - A.gx0) * UNITS_PER_PX - f.x, dz = (tgt.y - A.gy0) * UNITS_PER_PX - f.z
    const dist = Math.hypot(dx, dz)
    if (dist < 8) {
      if (++r.i >= r.pts.length) { const done = r.resolve; this.route = null; f.vx = f.vz = 0; done?.(); return }
      return
    }
    const want = Math.atan2(dx, -dz)
    let dy = want - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    f.yaw += dy * Math.min(1, dt * 2.5)
    const sp = Math.min(r.speed * this.timeScale, dist / Math.max(dt, 1e-3))
    f.vx = (dx / dist) * sp; f.vz = (dz / dist) * sp
    f.x += f.vx * dt; f.z += f.vz * dt
    f.pitch += (-0.22 - f.pitch) * Math.min(1, dt * 2)
    f.y += (r.alt - f.y) * Math.min(1, dt * 1.5)
    f.y = Math.min(Math.max(f.y, this.surfaceY(f.x, f.z) + 0.6), 60)
  }

  // ---- autopilot ----
  private apOn() { return !!this.geoRef && !this.manual && !this.route }
  private llAt(x: number, z: number) {
    const A = this.anchor()
    return { lat: latOfPy(A.gy0 + z / UNITS_PER_PX, A.z), lon: lonOfPx(A.gx0 + x / UNITS_PER_PX, A.z) }
  }
  private mpuAt(z: number) { const A = this.anchor(); return metresPerUnit(A.gy0 + z / UNITS_PER_PX, A.z) }

  /** Fly to this city next (a user choice circles it once on arrival). Also reachable from the store (`dest`). */
  setDestination(c: City | null, lap = false) {
    const a = this.ap
    a.dest = c; a.lap = lap; a.orbit = 0; a.orbitAcc = 0
    if (c) {
      this.lastDestStore = c
      if (useSettings.getState().dest !== c) useSettings.setState({ dest: c as any })
    }
  }
  private pickDestination(lat: number, lon: number) {
    const a = this.ap
    if (!getCities().length) return
    const tour = useSettings.getState().tour
    const c = pickNext(lat, lon, a.visited, tour ? 'near' : 'random')
    this.setDestination(c, tour)
  }

  private stepAutopilot(dt: number) {
    const f = this.fly, a = this.ap, st = useSettings.getState()
    const mult = st.apSpeed * this.timeScale
    const ll = this.llAt(f.x, f.z)
    if (!a.dest && !a.orbit) this.pickDestination(ll.lat, ll.lon)
    const vground = AP_BASE_MS * mult
    const vu = vground / this.mpuAt(f.z)
    const sq = Math.sqrt(Math.max(mult, 0.05))
    const maxRate = Math.min(AP_YAW_RATE * sq, 0.4)
    // --- where to head
    let want = f.yaw, rateCmd: number | null = null
    const d = a.dest
    if (d) {
      const dist = distanceM(ll.lat, ll.lon, d.lat, d.lon), brg = bearing(ll.lat, ll.lon, d.lat, d.lon)
      const Ro = vground / maxRate // radius of the lap: a gentle, constant-rate circle
      if (a.orbit) {
        const back = bearing(d.lat, d.lon, ll.lat, ll.lon)
        a.orbitAcc += wrapPi(back - a.orbitPrev); a.orbitPrev = back
        want = brg - (Math.PI / 2) * (1 - Math.max(-1, Math.min(1, (dist - Ro) / Ro)))
        if (Math.abs(a.orbitAcc) >= Math.PI * 2) { this.finishVisit() }
      } else {
        want = brg
        const arrive = a.lap ? 2 * Ro : Math.max(4000, vground * 1.5)
        if (dist < arrive) {
          if (a.lap) { a.orbit = 1; a.orbitAcc = 0; a.orbitPrev = bearing(d.lat, d.lon, ll.lat, ll.lon) } else this.finishVisit()
        }
      }
    }
    // --- turn gently, bank into it
    const err = wrapPi(want - f.yaw)
    const target = Math.max(-maxRate, Math.min(maxRate, err * 0.7))
    a.yawRate += (target - a.yawRate) * (1 - Math.exp(-dt * 1.4))
    f.yaw += a.yawRate * dt
    const bankT = Math.max(-AP_BANK_MAX, Math.min(AP_BANK_MAX, a.yawRate * 1.5))
    a.bank += (bankT - a.bank) * (1 - Math.exp(-dt * 1.8))
    // --- move over the ground
    const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw)
    a.spd = a.spd < 0 ? vu : a.spd + (vu - a.spd) * (1 - Math.exp(-dt * 1.2))
    f.vx = sy * a.spd; f.vz = -cy * a.spd
    f.x += f.vx * dt; f.z += f.vz * dt
    // --- altitude: cruise above the deck, now and then dip toward the ground, never closer than AP_FLOOR
    const look = Math.min(vu * 2.2, 130)
    let gAhead = this.surfaceY(f.x, f.z), gMin = gAhead
    for (const s of [0.2, 0.4, 0.7, 1]) {
      const g = this.surfaceY(f.x + sy * look * s, f.z - cy * look * s)
      gAhead = Math.max(gAhead, g); gMin = Math.min(gMin, g)
    }
    const dtS = dt * Math.sqrt(Math.max(mult, 1))
    a.drift += dtS
    a.dipT += dtS
    if (a.dipping > 0) { a.dipping -= dtS; if (a.dipping <= 0) { a.dipT = 0; a.nextDip = 80 + Math.random() * 80 } }
    else if (a.dipT > a.nextDip) {
      // low flight is for interesting terrain: rough ground ahead, not open sea
      let lo = 1e9, hi = -1e9
      for (let i = 1; i <= 6; i++) { const g = this.surfaceY(f.x + sy * 18 * i, f.z - cy * 18 * i); lo = Math.min(lo, g); hi = Math.max(hi, g) }
      if ((hi - lo > 4 &&hi > WATER_Y + 8) || a.dipT > a.nextDip + 120) a.dipping = 26 + Math.random() * 14
    }
    const cruise = AP_CRUISE_Y + 1.1 * Math.sin(a.drift * 0.11) + 0.5 * Math.sin(a.drift * 0.37 + 1)
    const wanted = a.dipping > 0 ? gAhead + AP_DIP_CLEAR : cruise
    const floor = gAhead + AP_FLOOR
    const maxV = 2.4 * Math.sqrt(Math.max(mult, 1))
    let vyT = Math.max(-maxV, Math.min(maxV, (Math.max(wanted, floor + 2) - f.y) * 0.45))
    if (f.y < floor + 1.5) vyT = Math.max(vyT, Math.min(maxV * 3, (floor + 1.5 - f.y) * 1.5)) // terrain rising: climb now
    a.vy += (vyT - a.vy) * (1 - Math.exp(-dt * 1.6))
    f.y += a.vy * dt
    const here = this.surfaceY(f.x, f.z)
    f.y = Math.min(Math.max(f.y, here + 1.6, floor - 0.6), 60)
    f.vy = a.vy
    const pitchT = Math.max(-0.45, Math.min(0.45, Math.atan2(a.vy, Math.max(vu, 1)))) - 0.07
    f.pitch += (pitchT - f.pitch) * (1 - Math.exp(-dt * 1.3))
    a.minClear = Math.min(a.minClear, f.y - here)
  }

  private finishVisit() {
    const a = this.ap, d = a.dest
    if (d) { a.visited.push(cityKey(d)); if (a.visited.length > 40) a.visited.shift() }
    a.orbit = 0; a.dest = null; a.lap = false
    // `dest` in the store is a user pick that is now done
    useSettings.setState({ dest: null }); this.lastDestStore = null
    const ll = this.llAt(this.fly.x, this.fly.z)
    this.pickDestination(ll.lat, ll.lon)
  }

  /** Local solar time at the camera, hours 0..24: the clock `tod` is the local time at the place's longitude. */
  private localHour(lon: number) {
    const sync = useSettings.getState().solarSync && !!this.geoRef
    return (((this.tod + (sync ? wrapPi((lon - this.lon0) * Math.PI / 180) * 12 / Math.PI : 0)) % 24) + 24) % 24
  }

  private updateHud(now: number) {
    const a = this.ap
    if (now < a.hudAt) return
    a.hudAt = now + 250
    const st = useSettings.getState()
    if (!st.hudOn || !this.geoRef) { if (useHud.getState().hud) useHud.setState({ hud: null }); return }
    const f = this.fly, c = this.camU.uCamPos.value
    const ll = this.camLatLon()
    const n = nearestCity(ll.lat, ll.lon)
    const d = a.dest
    const here = this.surfaceY(c.x, c.z)
    const exag = this.geoRef.exag ?? 1
    const kmh = Math.hypot(this.camVel.x, this.camVel.y) * this.groundMPerUnit() * 3.6
    useHud.setState({
      hud: {
        mode: this.manual ? 'manual' : 'auto', lat: ll.lat, lon: ll.lon,
        city: n?.city.name ?? '', state: n?.city.state ?? '', cityKm: n ? n.dist / 1000 : 0,
        cityDir: n ? COMPASS[Math.round(((n.bearing + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8] : '',
        altM: Math.max(0, (c.y - here) * this.groundMPerUnit() / exag),
        localHour: this.localHour(ll.lon),
        destName: d ? `${d.name}, ${d.state}` : '', destKm: d ? distanceM(ll.lat, ll.lon, d.lat, d.lon) / 1000 : 0,
        kmh, orbit: !!a.orbit,
      },
    })
    void f
  }

  private updateFly(dt: number) {
    if (this.route) { this.stepRoute(dt); return }
    if (this.geoRef && !this.manual) { this.stepAutopilot(dt); return }
    const f = this.fly, k = this.keys
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch), sy = Math.sin(f.yaw), cy = Math.cos(f.yaw)
    const fx = sy * cp, fy = sp, fz = -cy * cp // forward, wherever the camera points
    const rx = cy, rz = sy                     // right, level
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0)
    const str = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0)
    const rise = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0)
    const sp0 = (k.has('shift') ? 24 : 8) * this.timeScale
    const tx = (fx * fwd + rx * str) * sp0, ty = (fy * fwd + rise) * sp0, tz = (fz * fwd + rz * str) * sp0
    const a = 1 - Math.exp(-dt * 5) // ease in and out
    f.vx += (tx - f.vx) * a; f.vy += (ty - f.vy) * a; f.vz += (tz - f.vz) * a
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt
    f.y = Math.min(Math.max(f.y, this.surfaceY(f.x, f.z) + 0.25), 60) // stay above the ground
  }

  private updateCamera(t: number, aspect: number, dt = 0) {
    const { _f, _r, _u, _up, pointer } = this
    if (this.manual || this.apOn() || this.route) {
      this.updateFly(dt)
      const f = this.fly, cp = Math.cos(f.pitch)
      _f.set(Math.sin(f.yaw) * cp, Math.sin(f.pitch), -Math.cos(f.yaw) * cp)
      _up.set(0, 1, 0)
      _r.crossVectors(_f, _up).normalize()
      if (this.manual || this.route) this.ap.bank *= Math.exp(-dt * 3) // levels out when you take over
      if (Math.abs(this.ap.bank) > 1e-4) {
        _up.multiplyScalar(Math.cos(this.ap.bank)).addScaledVector(_r, -Math.sin(this.ap.bank))
        _r.crossVectors(_f, _up).normalize()
      }
      _u.crossVectors(_r, _f).normalize()
      this.camU.uCamPos.value.set(f.x, f.y, f.z)
      this.camU.uCamF.value.copy(_f); this.camU.uCamR.value.copy(_r); this.camU.uCamU.value.copy(_u)
      return
    }
    const z = -t * SPEED + this.pathShiftZ
    const x = pathX(z)
    const y = 3.6 + 0.3 * Math.sin(t * 0.071) + 0.09 * Math.sin(t * 0.19 + 1.0)
    const look = 16
    const xt = pathX(z - look)
    _f.set(xt - x, -0.95 + 0.25 * Math.sin(t * 0.043), -look).normalize()
    const zz = z - 6
    const curv = -5.0 * 0.012 * 0.012 * Math.sin(zz * 0.012) - 2.2 * 0.031 * 0.031 * Math.sin(zz * 0.031 + 1.3)
    const roll = THREE.MathUtils.clamp(curv * 9.0, -0.06, 0.06)
    pointer.sx += (pointer.x - pointer.sx) * 0.02
    pointer.sy += (pointer.y - pointer.sy) * 0.02
    const portraitBias = aspect < 1 ? -0.34 * (1 - aspect) : 0
    const yaw = pointer.sx * 0.12 + portraitBias
    const pitch = -pointer.sy * 0.06
    _up.set(Math.sin(roll), Math.cos(roll), 0)
    _r.crossVectors(_f, _up).normalize()
    _u.crossVectors(_r, _f).normalize()
    _f.addScaledVector(_r, yaw).addScaledVector(_u, pitch).normalize()
    _r.crossVectors(_f, _up).normalize()
    _u.crossVectors(_r, _f).normalize()
    this.camU.uCamPos.value.set(x, y, z)
    this.camU.uCamF.value.copy(_f); this.camU.uCamR.value.copy(_r); this.camU.uCamU.value.copy(_u)
  }

  /** Advance the simulation and draw one frame. `rawDt` in seconds. */
  step(rawDt: number) {
    if (!this.baked) {
      if (this.bakeActive) this.bakeStep()
      else if (this.terrainStep()) {
        this.baked = true; this.progress = 1; this.tMark('terrainDoneAt')
        const saved = useSettings.getState().place
        if (saved) { this.lastPlace = saved; void this.loadPlace(saved) }
      }
      return
    }
    const dt = Math.min(rawDt, 0.1)
    this.lastDt = dt
    this.lastRaw = rawDt
    if (!this.manual) this.simT += dt * (this.reduceMotion ? 0.35 : 1.0) * this.timeScale
    if (this.perfOn && rawDt < 2) this.perfMs.push(rawDt * 1000)
    this.clock += dt
    this.frame++
    const st = useSettings.getState()
    if (st.playing) {
      this.tod = (this.tod + (dt * 24 * st.todMult) / Math.max(st.dayLen, 5)) % 24
      this.todSync += dt
      if (this.todSync > 0.25) { this.todSync = 0; useSettings.setState({ tod: this.tod }) }
    }
    // after a place change, re-bake the terrain a few jobs per frame (the scene is faded out meanwhile)
    for (let i = 0, per = this.terrainRolling ? 2 : 8; i < per && this.terrainActive; i++) {
      if (this.terrainStep()) { this.terrainActive = false; this.onTerrainDone() }
    }
    this.trackVelocity(dt)
    this.maybeReanchor()
    this.updateHud(performance.now())
    this.updateRolling()
    this.updateMorph(dt)
    this.render()
    if (this.bakeActive) this.bakeStep() // background re-bake after a cloud-shape change
    this.adapt(rawDt)
    this.ready = this.frame > 2
  }

  private updateMorph(dt: number) {
    if (this.morphT < 0) return
    this.morphT += dt
    const m = Math.min(this.morphT / Math.max(this.morphDur, 0.5), 1)
    this.morphU.uMorph.value = Math.max(m, 0.0001)
    // the live shape settings (used by the ground shadow and masks) follow along
    const e = m * m * (3 - 2 * m), a = this.cfgFrom, b = this.cfgBake, l = this.cfgLive
    l.uCover.value = a.uCover.value + (b.uCover.value - a.uCover.value) * e
    l.uCumulus.value = a.uCumulus.value + (b.uCumulus.value - a.uCumulus.value) * e
    l.uStorm.value = a.uStorm.value + (b.uStorm.value - a.uStorm.value) * e
    l.uDeckH.value = a.uDeckH.value + (b.uDeckH.value - a.uDeckH.value) * e
    l.uWindV.value.lerpVectors(a.uWindV.value, b.uWindV.value, e)
    if (m - this.lastMorphUI >= 0.02 || m >= 1) { this.lastMorphUI = m; useSettings.setState({ morph: m >= 1 ? -1 : m }) }
    if (m >= 1) {
      // the new shape is now the whole picture: it is what we leave from next time
      let t = this.shapeFrom; this.shapeFrom = this.shapeTo; this.shapeTo = t
      t = this.lightFrom; this.lightFrom = this.lightTo; this.lightTo = t
      this.syncVolumes()
      this.morphU.uMorph.value = 0
      this.morphT = -1; this.lastMorphUI = -1
      if (this.pending) this.startBake(this.pending)
    }
  }

  // ---- dev helpers (exposed as window.__cloudScene by EngineHost) ----
  /** State of the long-distance machinery, for the console. */
  info() {
    const A = this.anchor(), c = this.camU.uCamPos.value, ll = this.camLatLon()
    return {
      lat: +ll.lat.toFixed(4), lon: +ll.lon.toFixed(4), zoom: A.z, camera: [c.x, c.y, c.z].map((v) => +v.toFixed(1)),
      anchorPx: [A.gx0, A.gy0], reanchors: this.reanchors, windowSwaps: this.timings.windowSwaps ?? 0,
      groundMPerUnit: +this.groundMPerUnit().toFixed(1), unitsPerSecond: +Math.hypot(this.camVel.x, this.camVel.y).toFixed(2),
      kmPerSecond: +((Math.hypot(this.camVel.x, this.camVel.y) * this.groundMPerUnit()) / 1000).toFixed(2),
      windowLoadSeconds: +this.loadEma.toFixed(2), timeScale: this.timeScale, exag: this.geoRef?.exag ?? null, fps: Math.round(this.fps),
    }
  }
  /** Multiply flight speed (auto path, WASD, routes). 1 = normal. */
  setSpeed(m: number) { this.timeScale = Math.max(0, m); return this.timeScale }
  /** Load a place and start there (same as picking it in the Place tab). Resolves when it is ready. */
  teleport(lat: number, lon: number, name = 'dev') {
    useSettings.getState().setPlace({ name, lat, lon })
    return new Promise<void>((resolve) => {
      const t0 = performance.now()
      const iv = setInterval(() => {
        const st = useSettings.getState()
        if ((st.placeStatus === 'ready' && st.fade === 0 && this.geoRef && !this.terrainActive) || st.placeStatus === 'error' || performance.now() - t0 > 60000) { clearInterval(iv); resolve() }
      }, 100)
    })
  }
  /** Fly (manual camera, straight in map space) through [lat, lon] waypoints at `speed` units/s x timeScale. Any key or drag cancels (unless opts.lock). */
  flyRoute(points: [number, number][], opts: { speed?: number; alt?: number; lock?: boolean } = {}) {
    const A = this.anchor()
    if (!this.geoRef) return Promise.reject(new Error('load a real place first (teleport)'))
    this.setManual(true)
    return new Promise<void>((resolve) => {
      this.route = { pts: points.map(([la, lo]) => ({ x: pxOfLon(lo, A.z), y: pxOfLat(la, A.z) })), i: 0, speed: opts.speed ?? 24, alt: opts.alt ?? 5, lock: !!opts.lock, resolve }
    })
  }
  flyTo(lat: number, lon: number, opts: { speed?: number; alt?: number; lock?: boolean } = {}) { return this.flyRoute([[lat, lon]], opts) }
  /** Record frame intervals (ms) until perfStop(). */
  perfStart() { this.perfMs = []; this.perfEvents = []; this.perfOn = true }
  perfStop() {
    this.perfOn = false
    const a = [...this.perfMs].sort((x, y) => x - y), n = a.length
    const q = (p: number) => +(a[Math.min(n - 1, Math.floor(n * p))] ?? 0).toFixed(1)
    return {
      frames: n, meanMs: +(a.reduce((x, y) => x + y, 0) / Math.max(n, 1)).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), maxMs: +(a[n - 1] ?? 0).toFixed(1),
      over25ms: a.filter((x) => x > 25).length, over40ms: a.filter((x) => x > 40).length, events: this.perfEvents,
    }
  }
  /** Strength of the large-scale cloud variety (distance units; 0, 0 turns it off). */
  setCloudVariety(a: number, b: number) { this.morphU.uBigAmp.value.set(a, b) }

  /** Deterministic stepping for the offline recorder. */
  advance(dt: number) { this.step(dt) }

  private render() {
    const r = this.renderer
    const tr = this.TIMING && this.frame <= 3 ? performance.now() : 0
    const w = this.width, h = this.height, aspect = w / h
    const { camU, raysPass, compPass, groundPass, taaPass, cloudPass } = this
    const tanHalf = Math.max(Math.tan(THREE.MathUtils.degToRad(27.5)), 0.33 / aspect)
    camU.uAspect.value = aspect
    camU.uTanHalf.value = tanHalf
    camU.uTime.value = this.clock
    this.applySun()
    camU.uFrame.value = this.frame
    this.updateCamera(this.simT, aspect, this.lastDt)

    const f = camU.uCamF.value, rr = camU.uCamR.value, u = camU.uCamU.value
    const mf = MOON_DIR.dot(f)
    let fade = 0
    if (mf > 0.05) {
      const mx = MOON_DIR.dot(rr) / mf / (tanHalf * aspect)
      const my = MOON_DIR.dot(u) / mf / tanHalf
      raysPass.u.uMoonUV.value.set(0.5 + 0.5 * mx, 0.5 + 0.5 * my)
      fade = THREE.MathUtils.clamp((1.6 - Math.max(Math.abs(mx), Math.abs(my))) / 0.6, 0, 1)
    }
    raysPass.u.uFade.value = fade
    raysPass.u.uMoonRuv.value = MOON_R / (2 * tanHalf)
    compPass.u.uPixAng.value = (2 * tanHalf) / (h * this.dpr)
    groundPass.u.uPixAngC.value = (2 * tanHalf) / this.cloudRT!.height
    compPass.u.uRes.value.set(w * this.dpr, h * this.dpr)

    r.setRenderTarget(this.cloudRT)
    r.render(cloudPass.scene, quadCam)
    groundPass.u.tCloud.value = this.cloudRT!.texture
    r.setRenderTarget(this.groundRT)
    r.render(groundPass.scene, quadCam)
    let clouds = this.groundRT
    if (this.USE_TAA) {
      taaPass.u.tCur.value = this.groundRT.texture
      taaPass.u.tHist.value = (this.carryHist || this.histA).texture
      r.setRenderTarget(this.histB)
      r.render(taaPass.scene, quadCam)
      if (this.carryHist) { this.carryHist.dispose(); this.carryHist = null }
      clouds = this.histB
      const tmp = this.histA; this.histA = this.histB; this.histB = tmp
      taaPass.u.uPrevPos.value.copy(camU.uCamPos.value)
      taaPass.u.uPrevR.value.copy(camU.uCamR.value)
      taaPass.u.uPrevU.value.copy(camU.uCamU.value)
      taaPass.u.uPrevF.value.copy(camU.uCamF.value)
      taaPass.u.uPrevTanHalf.value = camU.uTanHalf.value
      taaPass.u.uPrevAspect.value = camU.uAspect.value
      taaPass.u.uReset.value = 0
    }
    raysPass.u.tCloud.value = clouds.texture
    r.setRenderTarget(this.raysRT)
    r.render(raysPass.scene, quadCam)
    compPass.u.tCloud.value = clouds.texture
    compPass.u.tRays.value = this.raysRT.texture
    r.setRenderTarget(null)
    r.render(compPass.scene, quadCam)
    if (tr) { r.getContext().finish(); this.tAdd('firstFramesMs', performance.now() - tr); this.tMark('firstFrameAt') }
  }

  private adapt(rawDt: number) {
    if (!this.auto || rawDt > 0.25) return
    this.perfAcc += rawDt; this.perfN++
    if (this.perfN < 90) return
    const avg = (this.perfAcc / this.perfN) * 1000
    this.fps = 1000 / avg
    if (this.TIMING) { this.timings.fps = Math.round(this.fps); this.timings.cloudScale = Math.round(this.scale * 100) / 100 }
    this.perfAcc = 0; this.perfN = 0
    const now = this.clock
    if (avg > 24 && this.scale > SCALE_MIN) {
      this.scale = Math.max(SCALE_MIN, this.scale - (avg > 40 ? 0.12 : 0.06))
      this.lastDrop = now; this.lastScaleChange = now; this.resizeTargets()
    } else if (avg < 17.2 && this.scale < SCALE_MAX && now - this.lastDrop > 30 && now - this.lastScaleChange > 8) {
      this.scale = Math.min(SCALE_MAX, this.scale + 0.05)
      this.lastScaleChange = now; this.resizeTargets()
    }
  }
}
