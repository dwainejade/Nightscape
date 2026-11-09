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
import { loadElevationWindow, WINDOW_PX } from '../geo/elevation'

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

const pathX = (z: number) => 4.5 * Math.sin(z * 0.019634954) + 1.6 * Math.sin(z * 0.039269908 + 1.3)
const f32 = Math.fround
const fract = (x: number) => x - Math.floor(x)
function hash12js(x: number, y: number) {
  const a = fract(f32(x * f32(0.1031))), b = fract(f32(y * f32(0.1031)))
  const k = f32(a * (b + 33.33) + b * (a + 33.33) + a * (a + 33.33))
  return fract(f32((a + k + b + k) * (a + k)))
}
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
  private morphU = { uBake: { value: null as any }, uBake2: { value: null as any }, uLight: { value: null as any }, uLight2: { value: null as any }, uMorph: { value: 0 } }
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
  private realTex: THREE.DataTexture | null = null
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

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    renderer.autoClear = false
    const ext = renderer.extensions
    this.canFloat = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
    this.RT_TYPE = this.canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType
    this.USE_TAA = ext.has('EXT_color_buffer_float')
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
    }, camU, this.lightU, cfgLive, this.morphU))
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
      uMoonMap: { value: null }, uMoonReady: { value: 0 },
      uBalance: { value: new THREE.Vector3(1, 1, 1) }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
      uHighTint: { value: new THREE.Vector3(1, 1, 1) }, uShadowAmt: { value: 0 }, uHighAmt: { value: 0 },
      uLift: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.38 },
      uGrain: { value: 0.007 }, uRays: { value: 1 },
      tBolt: { value: null }, uBoltOn: { value: 0 }, uSkyFlash: { value: V3() }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
      uFar: { value: new THREE.Vector4(0, 0, -1, 0) }, uFarShape: { value: new THREE.Vector3(0.1, 0, 0.04) }, uFarCol: { value: new THREE.Vector4(1, 0.84, 0.74, 1) },
      uSunDir: { value: new THREE.Vector3(1, -1, 0) }, uDayAmt: { value: 0 }, uNightAmt: { value: 1 }, uTwi: { value: 0 },
      uAirOn: { value: 0 }, uAirW: { value: new THREE.Vector3(0, 1, 0) }, uAirR: { value: new THREE.Vector3(0, 1, 0) }, uAirG: { value: new THREE.Vector3(0, 1, 0) },
      uAirI: { value: V3() }, uConA: { value: V3() }, uConB: { value: V3() }, uCon: { value: new THREE.Vector4(0, 0, 150, 0) }, uGlitter: { value: 1 },
    }, camU, cfgLive))

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
    this.terHPass = makePass(TER_H_FRAG, Object.assign({ uNoise: { value: noiseTex }, uReal: { value: new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType) }, uUseReal: { value: 0 } }, cfgLive))
    this.terTPass = makePass(TER_T_FRAG, Object.assign({ uNoise: { value: noiseTex }, uTerH: { value: this.terH.texture }, uZ: { value: 0 } }, cfgLive))
    this.terLPass = makePass(TER_L_FRAG, Object.assign({ uNoise: { value: noiseTex }, uTerH: { value: this.terH.texture }, uMoonDir: { value: MOON_DIR }, uMode: { value: 0 } }, cfgLive))
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

    this.applyGrade()
    this.unsub = useSettings.subscribe((st) => {
      this.applyGrade()
      if (st.tod !== this.tod) this.tod = st.tod // moved from the panel
      if (st.place !== this.lastPlace) { const p = st.place; this.lastPlace = p; void this.loadPlace(p) }
      if (st.clouds !== this.lastClouds) { const c = st.clouds, p = this.lastClouds; this.lastClouds = c; this.onCloudsChanged(c, p) }
    })
  }

  dispose() {
    window.removeEventListener('pointermove', this.onPointer)
    document.removeEventListener('pointerleave', this.onLeave)
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

  /** Load a real place (or go back to the invented mountains) and re-bake the terrain under a fade to black. */
  private async loadPlace(p: Place | null) {
    const token = ++this.placeToken
    this.placeAbort?.abort()
    const S = useSettings
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    if (!this.baked) return // the saved place is started once the first bake is done
    S.setState({ fade: 1, placeStatus: p ? 'loading' : 'idle', placeInfo: '' })
    const t0 = performance.now()
    try {
      if (!p) {
        await sleep(450)
        if (token !== this.placeToken) return
        this.terHPass.u.uUseReal.value = 0
      } else {
        this.placeAbort = new AbortController()
        const d = await loadElevationWindow(p.lat, p.lon, 70, this.placeAbort.signal)
        if (token !== this.placeToken) return
        await sleep(Math.max(0, 450 - (performance.now() - t0))) // let the fade finish
        if (token !== this.placeToken) return
        this.realTex?.dispose()
        const tex = new THREE.DataTexture(d.half, WINDOW_PX, WINDOW_PX, THREE.RedFormat, THREE.HalfFloatType)
        tex.minFilter = tex.magFilter = THREE.LinearFilter
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.unpackAlignment = 2
        tex.needsUpdate = true
        this.realTex = tex
        this.terHPass.u.uReal.value = tex
        this.terHPass.u.uUseReal.value = 1
        const lo = Math.round(d.minElev), hi = Math.round(d.maxElev)
        S.setState({ placeInfo: `${Math.round(d.windowKm)} km across, ${lo} to ${hi} m, relief drawn ${d.exaggeration.toFixed(1)}x taller than true` })
      }
      this.simT = 0                       // start the flight over the middle of the place
      this.terJob = 0
      this.terrainActive = true
    } catch (e: any) {
      if (token !== this.placeToken || e?.name === 'AbortError') return
      S.setState({ placeStatus: 'error', placeInfo: String(e?.message ?? e), fade: 0 })
    }
  }

  private onTerrainDone() {
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
  }

  /** Sun position and day/night weights from the time of day (6 = sunrise in the east, 12 = high noon, 18 = sunset). */
  applySun() {
    const phi = ((this.tod - 6) / 12) * Math.PI
    const u = this.compPass.u
    const sy = Math.sin(phi)
    u.uSunDir.value.set(Math.cos(phi), sy * 0.9, -0.5 * sy).normalize()
    const y = u.uSunDir.value.y
    const sm = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
    const day = sm(-0.18, 0.1, y)
    u.uDayAmt.value = day
    u.uNightAmt.value = 1 - sm(-0.2, -0.02, y)
    u.uTwi.value = 1 - sm(0.0, 0.4, Math.abs(y + 0.04))
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
    const f = TILE / TER_N, picked: { x: number; z: number; y: number }[] = []
    const wrap = (d: number) => ((((d + TILE / 2) % TILE) + TILE) % TILE) - TILE / 2
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
    const f = TER_N / TILE
    const u = ((((x * f - 0.5) % TER_N) + TER_N) % TER_N), v = ((((z * f - 0.5) % TER_N) + TER_N) % TER_N)
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0
    const i1 = (i0 + 1) % TER_N, j1 = (j0 + 1) % TER_N
    const y = (H[j0 * TER_N + i0] * (1 - fu) + H[j0 * TER_N + i1] * fu) * (1 - fv) + (H[j1 * TER_N + i0] * (1 - fu) + H[j1 * TER_N + i1] * fu) * fv
    return Math.max(y, WATER_Y)
  }

  // ---- camera ----
  private _f = new THREE.Vector3(); private _r = new THREE.Vector3(); private _u = new THREE.Vector3(); private _up = new THREE.Vector3()
  private updateCamera(t: number, aspect: number) {
    const { _f, _r, _u, _up, pointer } = this
    const z = -t * SPEED
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
    this.simT += dt * (this.reduceMotion ? 0.35 : 1.0)
    this.clock += dt
    this.frame++
    const st = useSettings.getState()
    if (st.playing) {
      this.tod = (this.tod + (dt * 24) / Math.max(st.dayLen, 5)) % 24
      this.todSync += dt
      if (this.todSync > 0.25) { this.todSync = 0; useSettings.setState({ tod: this.tod }) }
    }
    // after a place change, re-bake the terrain a few jobs per frame (the scene is faded out meanwhile)
    for (let i = 0; i < 8 && this.terrainActive; i++) {
      if (this.terrainStep()) { this.terrainActive = false; this.onTerrainDone() }
    }
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
    this.updateCamera(this.simT, aspect)

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
