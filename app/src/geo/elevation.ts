// Real elevation from the open Terrarium tiles (AWS Open Data, no key needed).
// https://registry.opendata.aws/terrain-tiles/
import * as THREE from 'three'

// must match TERRAIN_COMMON in the shaders and the engine
const WATER_Y = -85, TER_LO = -100, TER_RANGE = 52
const TOP_Y = TER_LO + TER_RANGE - 1.2
export const WINDOW_PX = 512 // the texture the terrain bake reads; the bake's tile is 2 x 2 mirrored copies of it
const TILE_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

export interface ElevationWindow {
  /** half-float heights in the terrain bake's stored scale, WINDOW_PX x WINDOW_PX, row 0 = north */
  half: Uint16Array
  windowKm: number
  zoom: number
  minElev: number
  maxElev: number
  /** how much taller than true scale the relief is drawn */
  exaggeration: number
}

const cache = new Map<string, Float32Array>()

/** Decode one Terrarium tile to metres (256 x 256). */
export async function fetchTileElevation(z: number, x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
  if (hit) return hit
  const res = await fetch(TILE_URL(z, x, y), { signal })
  if (!res.ok) throw new Error(`Elevation tile ${key} failed (${res.status})`)
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const cv = new OffscreenCanvas(256, 256)
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const px = ctx.getImageData(0, 0, 256, 256).data
  const out = new Float32Array(256 * 256)
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768
  if (cache.size > 200) cache.delete(cache.keys().next().value!)
  cache.set(key, out)
  return out
}

const mercX = (lon: number, n: number) => ((lon + 180) / 360) * n * 256
const mercY = (lat: number, n: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n * 256

/**
 * Fetch a WINDOW_PX square of real elevation centred on (lat, lon), roughly `targetKm` across,
 * and convert it to the height scale the terrain bake expects.
 */
export async function loadElevationWindow(lat: number, lon: number, targetKm = 70, signal?: AbortSignal): Promise<ElevationWindow> {
  lat = Math.max(-84, Math.min(84, lat))
  const cosL = Math.cos((lat * Math.PI) / 180)
  const z = Math.max(5, Math.min(12, Math.round(Math.log2((156543.03392 * cosL * WINDOW_PX) / (targetKm * 1000)))))
  const n = 2 ** z
  const x0 = Math.round(mercX(lon, n)) - WINDOW_PX / 2
  const y0 = Math.round(mercY(lat, n)) - WINDOW_PX / 2
  const tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x0 + WINDOW_PX - 1) / 256)
  const ty0 = Math.floor(y0 / 256), ty1 = Math.floor((y0 + WINDOW_PX - 1) / 256)

  const jobs: Promise<void>[] = []
  const elev = new Float32Array(WINDOW_PX * WINDOW_PX) // metres; off the top or bottom of the map stays 0 (sea)
  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = tx0; tx <= tx1; tx++) {
      const wx = ((tx % n) + n) % n
      jobs.push(fetchTileElevation(z, wx, ty, signal).then((t) => {
        for (let j = 0; j < 256; j++) {
          const gy = ty * 256 + j - y0
          if (gy < 0 || gy >= WINDOW_PX) continue
          for (let i = 0; i < 256; i++) {
            const gx = tx * 256 + i - x0
            if (gx < 0 || gx >= WINDOW_PX) continue
            elev[gy * WINDOW_PX + gx] = t[j * 256 + i]
          }
        }
      }))
    }
  }
  await Promise.all(jobs)

  // Pick the vertical scale from the land in view: tall ranges use up to 35 world units of relief,
  // flat country is not blown up into mountains.
  const land: number[] = []
  let minE = Infinity, maxE = -Infinity
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i]
    if (e < minE) minE = e
    if (e > maxE) maxE = e
    if (e > 0.5) land.push(e)
  }
  land.sort((a, b) => a - b)
  const p998 = land.length ? land[Math.min(land.length - 1, Math.floor(land.length * 0.998))] : 0
  const top = Math.max(p998, 60)
  const relief = Math.max(5, Math.min(35, top / 60))
  const perMetre = relief / top

  const half = new Uint16Array(elev.length)
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i]
    let y: number
    if (e > 0.5) y = Math.min(WATER_Y + 0.15 + Math.min(e, top * 1.15) * perMetre, TOP_Y)
    else y = WATER_Y + Math.max(e / 200, -1) * 12 // sea floor, kept shallow so the water stays readable
    half[i] = THREE.DataUtils.toHalfFloat((y - TER_LO) / TER_RANGE)
  }

  const mpp = (156543.03392 * cosL) / n
  const worldUnitsPerPixel = 160 / WINDOW_PX // the window spans 160 of the tile's 320 world units
  return {
    half,
    windowKm: (WINDOW_PX * mpp) / 1000,
    zoom: z,
    minElev: minE,
    maxElev: maxE,
    exaggeration: perMetre / (worldUnitsPerPixel / mpp),
  }
}

/** Colour an elevation tile for the map picker: sea depth, then green lowlands to snowy peaks, with a touch of hillshade. */
export async function tileToCanvas(z: number, x: number, y: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const e = await fetchTileElevation(z, x, y, signal)
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(256, 256)
  const mpp = (156543.03392 * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z))))) / 2 ** z
  const at = (i: number, j: number) => e[Math.max(0, Math.min(255, j)) * 256 + Math.max(0, Math.min(255, i))]
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const h = e[j * 256 + i]
      let r: number, g: number, b: number
      if (h <= 0) {
        const t = Math.min(1, -h / 4500)
        r = 28 - 20 * t; g = 92 - 60 * t; b = 140 - 50 * t
      } else if (h < 400) { const t = h / 400; r = 70 + 40 * t; g = 128 + 14 * t; b = 70 }
      else if (h < 1600) { const t = (h - 400) / 1200; r = 110 + 80 * t; g = 142 + 2 * t; b = 70 + 20 * t }
      else if (h < 3500) { const t = (h - 1600) / 1900; r = 190 - 50 * t; g = 144 - 30 * t; b = 90 + 10 * t }
      else { const t = Math.min(1, (h - 3500) / 2500); r = 140 + 115 * t; g = 114 + 141 * t; b = 100 + 155 * t }
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * mpp), dy = (at(i, j + 1) - at(i, j - 1)) / (2 * mpp)
      const shade = h <= 0 ? 1 : Math.max(0.55, Math.min(1.5, 1 - 5 * (dx + dy)))
      const o = (j * 256 + i) * 4
      img.data[o] = Math.min(255, r * shade); img.data[o + 1] = Math.min(255, g * shade); img.data[o + 2] = Math.min(255, b * shade); img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}
