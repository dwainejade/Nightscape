// Real terrain for the flight: a square window of elevation (Terrarium, AWS Open Data) and
// satellite colour (Sentinel-2 cloudless by EOX) around a point, in Web Mercator pixels.
//
// Imagery: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH
// (Contains modified Copernicus Sentinel data 2016)", licensed CC BY 4.0. Keep that attribution visible.
import * as THREE from 'three'
import { fetchTileElevation } from './elevation'

export const WIN = 1024 // window size in pixels; the terrain bake is 1024 x 1024, so one pixel is one texel
/** World size of the terrain tile for real places (the invented mountains use 320). */
export const REAL_TILE = 640
/** World units per window pixel. */
export const UNITS_PER_PX = REAL_TILE / WIN

// must match TERRAIN_COMMON in the shaders
const WATER_Y = -85, TER_LO = -100, TER_RANGE = 52
const TOP_Y = TER_LO + TER_RANGE - 1.2

const MPP0 = 156543.03392 // metres per Web Mercator pixel at zoom 0 on the equator
const IMG_URL = (z: number, x: number, y: number) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`

/** Where a place sits in Web Mercator pixels, and the vertical scale chosen for it. */
export interface GeoRef {
  z: number
  /** pixel position of world (0, 0), not rounded. Moves by whole windows when the engine re-anchors. */
  gx0: number
  gy0: number
  /**
   * Vertical exaggeration (relief drawn vs. true, measured against the local horizontal scale). Fixed
   * after the first window, then held for the whole flight; the height scale at any latitude follows
   * from it (see `perMetreAtRow`), so relief stays proportionate as Mercator stretches with latitude.
   */
  exag: number | null
  windowKm: number
  exaggeration: number
}

export interface TerrainWindow {
  /** half-float heights in the terrain bake's stored scale, WIN x WIN, row 0 = north */
  half: Uint16Array
  /** sRGB colour, WIN x WIN x 4, row 0 = north */
  rgba: Uint8Array
  /** integer pixel position of the window centre */
  cx: number
  cy: number
  minElev: number
  maxElev: number
}

const mercX = (lon: number, n: number) => ((lon + 180) / 360) * n * 256
const mercY = (lat: number, n: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n * 256
/** Latitude (degrees) of Mercator pixel row `py` at zoom `z`. */
export const latOfPy = (py: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (2 ** z * 256)))) * 180) / Math.PI
/** Longitude (degrees, wrapped to -180..180) of Mercator pixel column `px` at zoom `z`. */
export const lonOfPx = (px: number, z: number) => { const l = (px / (2 ** z * 256)) * 360 - 180; return ((((l + 180) % 360) + 360) % 360) - 180 }
export const pxOfLat = (lat: number, z: number) => mercY(Math.max(-85, Math.min(85, lat)), 2 ** z)
export const pxOfLon = (lon: number, z: number) => mercX(lon, 2 ** z)
/** Metres on the ground that one world unit stands for, at Mercator pixel row `py`. Shrinks with 1/cos(lat) stretch. */
export const metresPerUnit = (py: number, z: number) => (MPP0 * Math.cos((latOfPy(py, z) * Math.PI) / 180)) / 2 ** z / UNITS_PER_PX

export function makeGeoRef(lat: number, lon: number, targetKm = 150): GeoRef {
  lat = Math.max(-82, Math.min(82, lat))
  const cosL = Math.cos((lat * Math.PI) / 180)
  const z = Math.max(5, Math.min(12, Math.round(Math.log2((MPP0 * cosL * WIN) / (targetKm * 1000)))))
  const n = 2 ** z
  return { z, gx0: mercX(lon, n), gy0: mercY(lat, n), exag: null, windowKm: (WIN * MPP0 * cosL) / n / 1000, exaggeration: 1 }
}

// ---- tile caches (capped; in-flight requests are shared so a prefetch and a window load never fetch twice) ----
const IMG_CAP = 110
const imgCache = new Map<string, ImageBitmap | null>()
const imgPending = new Map<string, Promise<ImageBitmap | null>>()

function fetchImageTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ImageBitmap | null> {
  const key = `${z}/${x}/${y}`
  if (imgCache.has(key)) { const v = imgCache.get(key)!; imgCache.delete(key); imgCache.set(key, v); return Promise.resolve(v) } // refresh recency
  const hit = imgPending.get(key)
  if (hit) return hit
  const pr = (async () => {
    let bmp: ImageBitmap | null = null
    try {
      const res = await fetch(IMG_URL(z, x, y), { signal })
      if (res.ok) bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
    } finally { imgPending.delete(key) }
    while (imgCache.size >= IMG_CAP) { const k = imgCache.keys().next().value!; imgCache.get(k)?.close(); imgCache.delete(k) }
    imgCache.set(key, bmp)
    return bmp
  })()
  imgPending.set(key, pr)
  return pr
}

/** Tile indices a window centred on pixel (cx, cy) needs. */
function windowTiles(z: number, cx: number, cy: number) {
  const n = 2 ** z, x0 = cx - WIN / 2, y0 = cy - WIN / 2
  const tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x0 + WIN - 1) / 256)
  const ty0 = Math.floor(y0 / 256), ty1 = Math.floor((y0 + WIN - 1) / 256)
  const out: { tx: number; ty: number; wx: number }[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = tx0; tx <= tx1; tx++) out.push({ tx, ty, wx: ((tx % n) + n) % n })
  }
  return { x0, y0, tiles: out }
}

/** Warm the tile caches for a window we expect to need soon (does nothing visible; errors are ignored). */
export function prefetchWindow(ref: GeoRef, cx: number, cy: number, signal?: AbortSignal) {
  for (const t of windowTiles(ref.z, cx, cy).tiles) {
    fetchTileElevation(ref.z, t.wx, t.ty, signal).catch(() => {})
    fetchImageTile(ref.z, t.wx, t.ty, signal).catch(() => {})
  }
}

// ---- cheap float32 -> half (the bake reads these as R16F) ----
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer)
function toHalf(v: number) {
  _f32[0] = v
  const x = _u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff
  if (e <= 0) return e < -10 ? sign : sign | ((m | 0x800000) >> (14 - e))
  if (e >= 31) return sign | 0x7c00
  return sign | (e << 10) | (m >> 13)
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0))
/** Yields to the browser when the current slice has used its time budget, so a window bake never holds a frame. */
function makeSlicer(budgetMs = 3) {
  let t = performance.now()
  return async (signal?: AbortSignal) => {
    if (performance.now() - t < budgetMs) return
    await nextTick()
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    t = performance.now()
  }
}

// vertical scale (heights are drawn in world units; the terrain bake stores them as (y - TER_LO) / TER_RANGE)
const RELIEF_KNEE = 20, RELIEF_MAX = 34, EXAG_MIN = 2.5, EXAG_MAX = 7
const softRelief = (r: number) => (r <= RELIEF_KNEE ? r : RELIEF_KNEE + (RELIEF_MAX - RELIEF_KNEE) * (1 - Math.exp(-(r - RELIEF_KNEE) / (RELIEF_MAX - RELIEF_KNEE))))

/**
 * Load the window centred on pixel (cx, cy) of `ref`'s zoom level. The first call for a place also
 * fixes its vertical exaggeration. Heavy loops are time-sliced, so awaiting this never stalls a frame.
 */
export async function loadTerrainWindow(ref: GeoRef, cx: number, cy: number, signal?: AbortSignal): Promise<TerrainWindow> {
  const z = ref.z
  const { x0, y0, tiles } = windowTiles(z, cx, cy)
  const slice = makeSlicer()

  const elev = new Float32Array(WIN * WIN) // metres; off the top or bottom of the map stays 0 (sea)
  const canvas = new OffscreenCanvas(WIN, WIN)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#10243a' // where a satellite tile is missing
  ctx.fillRect(0, 0, WIN, WIN)

  const imgs: (ImageBitmap | null)[] = []
  const jobs: Promise<void>[] = []
  tiles.forEach((tl, k) => {
    jobs.push(fetchTileElevation(z, tl.wx, tl.ty, signal).then((t) => {
      for (let j = 0; j < 256; j++) {
        const gy = tl.ty * 256 + j - y0
        if (gy < 0 || gy >= WIN) continue
        for (let i = 0; i < 256; i++) {
          const gx = tl.tx * 256 + i - x0
          if (gx >= 0 && gx < WIN) elev[gy * WIN + gx] = t[j * 256 + i]
        }
      }
    }))
    jobs.push(fetchImageTile(z, tl.wx, tl.ty, signal).then((bmp) => { imgs[k] = bmp }))
  })
  await Promise.all(jobs)
  for (let k = 0; k < tiles.length; k++) {
    const bmp = imgs[k]
    if (bmp) ctx.drawImage(bmp, tiles[k].tx * 256 - x0, tiles[k].ty * 256 - y0)
    await slice(signal)
  }

  let minE = Infinity, maxE = -Infinity
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i]
    if (e < minE) minE = e
    if (e > maxE) maxE = e
  }
  await slice(signal)
  if (ref.exag === null) {
    // How tall to draw the land, from the first window's high ground (p99.8 over a sparse sample): flat country
    // is not blown up into mountains, and tall ranges stay inside the height budget.
    const sample: number[] = []
    for (let i = 0; i < elev.length; i += 7) if (elev[i] > 0.5) sample.push(elev[i])
    sample.sort((a, b) => a - b)
    const p998 = sample.length ? sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.998))] : 0
    const top = Math.max(p998, 60)
    const relief = Math.max(5, Math.min(35, top / 60))
    const mpu = metresPerUnit(cy, z)
    ref.exag = Math.max(EXAG_MIN, Math.min(EXAG_MAX, (relief / top) * mpu))
    ref.exaggeration = ref.exag
  }
  const exag = ref.exag

  // Mercator stretches the map by 1/cos(lat), so a metre of height is worth a different number of world
  // units on each row: perMetre(row) = exag / metresPerUnit(row). Keyed to the row's own latitude (not to the
  // window), so adjacent windows agree exactly and the relief is proportionate from south to north.
  const half = new Uint16Array(elev.length)
  for (let j = 0; j < WIN; j++) {
    const pm = exag / metresPerUnit(y0 + j + 0.5, z)
    for (let i = j * WIN, end = i + WIN; i < end; i++) {
      const e = elev[i]
      let y: number
      if (e > 0.5) y = Math.min(WATER_Y + 0.15 + softRelief(e * pm), TOP_Y)
      else y = WATER_Y + Math.max(e / 200, -1) * 12 // sea floor, kept shallow so the water stays readable
      half[i] = toHalf((y - TER_LO) / TER_RANGE)
    }
    if ((j & 31) === 31) await slice(signal)
  }
  const rgba = new Uint8Array(ctx.getImageData(0, 0, WIN, WIN).data.buffer.slice(0))
  return { half, rgba, cx, cy, minElev: minE, maxElev: maxE }
}
