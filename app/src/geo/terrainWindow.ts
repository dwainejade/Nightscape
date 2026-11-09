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

const IMG_URL = (z: number, x: number, y: number) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`

/** Where a place sits in Web Mercator pixels, and the vertical scale chosen for it. */
export interface GeoRef {
  z: number
  /** pixel position of world (0, 0), not rounded */
  gx0: number
  gy0: number
  /** vertical scale, fixed after the first window so heights stay consistent as the window moves */
  top: number | null
  perMetre: number | null
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

export function makeGeoRef(lat: number, lon: number, targetKm = 150): GeoRef {
  lat = Math.max(-82, Math.min(82, lat))
  const cosL = Math.cos((lat * Math.PI) / 180)
  const z = Math.max(5, Math.min(12, Math.round(Math.log2((156543.03392 * cosL * WIN) / (targetKm * 1000)))))
  const n = 2 ** z
  return { z, gx0: mercX(lon, n), gy0: mercY(lat, n), top: null, perMetre: null, windowKm: (WIN * 156543.03392 * cosL) / n / 1000, exaggeration: 1 }
}

// decoded satellite tiles, newest last
const imgCache = new Map<string, ImageBitmap | null>()

async function fetchImageTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ImageBitmap | null> {
  const key = `${z}/${x}/${y}`
  if (imgCache.has(key)) return imgCache.get(key)!
  let bmp: ImageBitmap | null = null
  try {
    const res = await fetch(IMG_URL(z, x, y), { signal })
    if (res.ok) bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
  }
  if (imgCache.size > 150) { const k = imgCache.keys().next().value!; imgCache.get(k)?.close(); imgCache.delete(k) }
  imgCache.set(key, bmp)
  return bmp
}

/**
 * Load the window centred on pixel (cx, cy) of `ref`'s zoom level. The first call for a place also
 * fixes its vertical scale: tall ranges use up to 35 world units of relief, flat country is not
 * blown up into mountains.
 */
export async function loadTerrainWindow(ref: GeoRef, cx: number, cy: number, signal?: AbortSignal): Promise<TerrainWindow> {
  const z = ref.z, n = 2 ** z
  const x0 = cx - WIN / 2, y0 = cy - WIN / 2
  const tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x0 + WIN - 1) / 256)
  const ty0 = Math.floor(y0 / 256), ty1 = Math.floor((y0 + WIN - 1) / 256)

  const elev = new Float32Array(WIN * WIN) // metres; off the top or bottom of the map stays 0 (sea)
  const canvas = new OffscreenCanvas(WIN, WIN)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#10243a' // where a satellite tile is missing
  ctx.fillRect(0, 0, WIN, WIN)

  const jobs: Promise<void>[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = tx0; tx <= tx1; tx++) {
      const wx = ((tx % n) + n) % n
      jobs.push(fetchTileElevation(z, wx, ty, signal).then((t) => {
        for (let j = 0; j < 256; j++) {
          const gy = ty * 256 + j - y0
          if (gy < 0 || gy >= WIN) continue
          for (let i = 0; i < 256; i++) {
            const gx = tx * 256 + i - x0
            if (gx >= 0 && gx < WIN) elev[gy * WIN + gx] = t[j * 256 + i]
          }
        }
      }))
      jobs.push(fetchImageTile(z, wx, ty, signal).then((bmp) => {
        if (bmp) ctx.drawImage(bmp, tx * 256 - x0, ty * 256 - y0)
      }))
    }
  }
  await Promise.all(jobs)

  let minE = Infinity, maxE = -Infinity
  const land: number[] = []
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i]
    if (e < minE) minE = e
    if (e > maxE) maxE = e
    if (e > 0.5) land.push(e)
  }
  if (ref.top === null) {
    land.sort((a, b) => a - b)
    const p998 = land.length ? land[Math.min(land.length - 1, Math.floor(land.length * 0.998))] : 0
    const top = Math.max(p998, 60)
    const relief = Math.max(5, Math.min(35, top / 60))
    ref.top = top
    ref.perMetre = relief / top
    const mPerUnit = ((WIN * 156543.03392 * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / (n * 256)))))) / n) / REAL_TILE
    ref.exaggeration = ref.perMetre * mPerUnit
  }
  const top = ref.top!, perMetre = ref.perMetre!

  const half = new Uint16Array(elev.length)
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i]
    let y: number
    if (e > 0.5) y = Math.min(WATER_Y + 0.15 + Math.min(e, top * 1.15) * perMetre, TOP_Y)
    else y = WATER_Y + Math.max(e / 200, -1) * 12 // sea floor, kept shallow so the water stays readable
    half[i] = THREE.DataUtils.toHalfFloat((y - TER_LO) / TER_RANGE)
  }
  const rgba = new Uint8Array(ctx.getImageData(0, 0, WIN, WIN).data.buffer.slice(0))
  return { half, rgba, cx, cy, minElev: minE, maxElev: maxE }
}
