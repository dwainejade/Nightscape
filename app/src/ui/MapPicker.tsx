import { useEffect, useRef, useState } from 'react'
import { tileToCanvas } from '../geo/elevation'

// A small slippy map drawn from the same open elevation tiles the terrain uses, so it needs no map service.
// Drag to pan, wheel to zoom, click to drop a pin.
interface Props { initial?: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void; onClose: () => void }

const MAX_TILE_Z = 9
const W = 640, H = 400

const worldX = (lon: number, s: number) => ((lon + 180) / 360) * s
const worldY = (lat: number, s: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * s
const lonOf = (x: number, s: number) => (x / s) * 360 - 180
const latOf = (y: number, s: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / s))) * 180) / Math.PI

export function MapPicker({ initial, onPick, onClose }: Props) {
  const cv = useRef<HTMLCanvasElement>(null)
  const view = useRef({ lat: initial?.lat ?? 30, lon: initial?.lon ?? 0, zoom: initial ? 6 : 1.6 })
  const pin = useRef<{ lat: number; lon: number } | null>(initial ?? null)
  const tiles = useRef(new Map<string, HTMLCanvasElement | 'loading' | 'failed'>())
  const dirty = useRef(true)
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(initial ?? null)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!dirty.current || !cv.current) return
      dirty.current = false
      const ctx = cv.current.getContext('2d')!
      const v = view.current
      const s = 256 * 2 ** v.zoom
      const zi = Math.max(0, Math.min(MAX_TILE_Z, Math.floor(v.zoom)))
      const ts = 256 * 2 ** (v.zoom - zi) // on-screen size of a tile at level zi
      const cx = worldX(v.lon, s), cy = worldY(v.lat, s)
      ctx.fillStyle = '#0a1a2a'
      ctx.fillRect(0, 0, W, H)
      const n = 2 ** zi
      const x0 = Math.floor((cx - W / 2) / ts), x1 = Math.floor((cx + W / 2) / ts)
      const y0 = Math.max(0, Math.floor((cy - H / 2) / ts)), y1 = Math.min(n - 1, Math.floor((cy + H / 2) / ts))
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const wx = ((tx % n) + n) % n
          const key = `${zi}/${wx}/${ty}`
          const t = tiles.current.get(key)
          if (!t) {
            tiles.current.set(key, 'loading')
            tileToCanvas(zi, wx, ty).then((c) => { tiles.current.set(key, c); dirty.current = true }).catch(() => tiles.current.set(key, 'failed'))
          } else if (t !== 'loading' && t !== 'failed') {
            ctx.drawImage(t, Math.round(tx * ts - (cx - W / 2)), Math.round(ty * ts - (cy - H / 2)), Math.ceil(ts), Math.ceil(ts))
          }
        }
      }
      const p = pin.current
      if (p) {
        const px = worldX(p.lon, s) - (cx - W / 2), py = worldY(p.lat, s) - (cy - H / 2)
        for (const k of [-W * 0, 0]) {
          ctx.beginPath(); ctx.arc(px + k, py, 7, 0, Math.PI * 2)
          ctx.fillStyle = '#ff4d4d'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke()
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture(e.pointerId) }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    d.x = e.clientX; d.y = e.clientY
    const v = view.current, s = 256 * 2 ** v.zoom
    v.lon = lonOf(worldX(v.lon, s) - dx, s)
    v.lat = Math.max(-84, Math.min(84, latOf(worldY(v.lat, s) - dy, s)))
    dirty.current = true
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const v = view.current, s = 256 * 2 ** v.zoom
    const x = worldX(v.lon, s) + (e.clientX - r.left - W / 2), y = worldY(v.lat, s) + (e.clientY - r.top - H / 2)
    const lat = Math.max(-84, Math.min(84, latOf(y, s))), lon = ((lonOf(x, s) + 540) % 360) - 180
    pin.current = { lat, lon }
    setPicked({ lat, lon })
    dirty.current = true
  }
  const onWheel = (e: React.WheelEvent) => {
    view.current.zoom = Math.max(0.5, Math.min(MAX_TILE_Z + 1, view.current.zoom - e.deltaY * 0.002))
    dirty.current = true
  }

  return (
    <div data-ui style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#000a', zIndex: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#050a0c', border: '1px solid #fff3', borderRadius: 10, padding: 12, color: '#cfe', font: '12px system-ui', maxWidth: '96vw' }}>
        <canvas ref={cv} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}
          style={{ display: 'block', width: '100%', maxWidth: W, aspectRatio: `${W}/${H}`, borderRadius: 6, cursor: 'crosshair', touchAction: 'none' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <span style={{ flex: 1, opacity: 0.8 }}>
            {picked ? `${picked.lat.toFixed(3)}, ${picked.lon.toFixed(3)}` : 'Drag to move, scroll to zoom, click to drop a pin'}
          </span>
          <button onClick={onClose} style={btn}>Cancel</button>
          <button disabled={!picked} onClick={() => picked && onPick(picked.lat, picked.lon)} style={{ ...btn, background: picked ? '#2a6' : '#0006', opacity: picked ? 1 : 0.5 }}>Fly here</button>
        </div>
        <div style={{ opacity: 0.5, marginTop: 6, fontSize: 10 }}>Map drawn from open elevation data (Terrarium / AWS Open Data).</div>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = { background: '#0006', color: 'inherit', border: '1px solid #fff3', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }
