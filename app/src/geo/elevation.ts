// Real elevation from the open Terrarium tiles (AWS Open Data, no key needed).
// https://registry.opendata.aws/terrain-tiles/

const TILE_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

const cache = new Map<string, Float32Array>()
const pending = new Map<string, Promise<Float32Array>>()
const CAP = 110

/** Decode one Terrarium tile to metres (256 x 256). */
export function fetchTileElevation(z: number, x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit) } // refresh recency
  const run = pending.get(key)
  if (run) return run
  const pr = decodeTile(z, x, y, key, signal).finally(() => pending.delete(key))
  pending.set(key, pr)
  return pr
}

async function decodeTile(z: number, x: number, y: number, key: string, signal?: AbortSignal): Promise<Float32Array> {
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
  while (cache.size >= CAP) cache.delete(cache.keys().next().value!)
  cache.set(key, out)
  return out
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
