import { useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { searchPlaces, type PlaceHit } from '../geo/geocode'
import { useSettings } from '../store/settings'
import { MapPicker } from './MapPicker'

const chip = (on = false): CSSProperties => ({
  background: on ? '#2a6' : '#0006', color: 'inherit', border: '1px solid #fff3', borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
})

const PRESETS: PlaceHit[] = [
  { name: 'Jersey Shore, NJ', lat: 39.43, lon: -74.35 },
  { name: 'Watchung Mountains, NJ', lat: 40.7, lon: -74.4 },
  { name: 'Zermatt, Alps', lat: 46.02, lon: 7.75 },
  { name: 'Grand Canyon', lat: 36.1, lon: -112.1 },
  { name: 'Everest region', lat: 28.0, lon: 86.9 },
  { name: 'Norwegian fjords', lat: 61.5, lon: 6.8 },
  { name: 'Hawaii (Big Island)', lat: 19.6, lon: -155.5 },
  { name: 'Iceland', lat: 64.6, lon: -19.0 },
  { name: 'Patagonia', lat: -49.3, lon: -73.0 },
]

export function PlaceTab() {
  const { place, setPlace, placeStatus, placeInfo } = useSettings()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [msg, setMsg] = useState('')
  const [map, setMap] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const go = (h: PlaceHit) => { setHits([]); setMsg(''); setPlace({ name: h.name, lat: h.lat, lon: h.lon }) }
  const search = async () => {
    abort.current?.abort()
    abort.current = new AbortController()
    setMsg('Searching...'); setHits([])
    try {
      const r = await searchPlaces(q, abort.current.signal)
      setHits(r); setMsg(r.length ? '' : 'No places found.')
    } catch (e: any) {
      if (e?.name !== 'AbortError') setMsg(String(e?.message ?? e))
    }
  }

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); void search() }} style={{ display: 'flex', gap: 4 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place..." onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: 1, minWidth: 0, background: '#0008', color: 'inherit', border: '1px solid #fff3', borderRadius: 4, padding: '4px 6px' }} />
        <button type="submit" style={chip()}>Go</button>
      </form>
      <div style={{ minHeight: 14, marginTop: 4, opacity: 0.7, fontSize: 11 }}>{msg}</div>
      {hits.map((h, i) => (
        <button key={i} onClick={() => go(h)} style={{ ...chip(), display: 'block', width: '100%', textAlign: 'left', marginBottom: 3 }}>{h.name}</button>
      ))}

      <div style={{ display: 'flex', gap: 4, margin: '8px 0' }}>
        <button onClick={() => setMap(true)} style={chip()}>Pick on map</button>
        <button onClick={() => setPlace(null)} style={chip(!place)}>Invented mountains</button>
      </div>

      <div style={{ marginTop: 6, opacity: 0.6, textTransform: 'uppercase', fontSize: 10 }}>Try</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {PRESETS.map((p) => <button key={p.name} onClick={() => go(p)} style={chip(place?.name === p.name)}>{p.name}</button>)}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.85, lineHeight: 1.4 }}>
        {placeStatus === 'loading' && 'Fetching elevation...'}
        {placeStatus === 'error' && `Could not load: ${placeInfo}`}
        {placeStatus === 'ready' && place && <><b>{place.name}</b><br />{placeInfo}</>}
        {placeStatus === 'idle' && !place && 'Showing invented mountains. Search or pick a place to fly over real terrain.'}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, opacity: 0.5, lineHeight: 1.4 }}>
        Terrain from open Terrarium elevation tiles; search by OpenStreetMap Nominatim. Lakes, towns and forests are still generated, not real.
      </div>

      {map && createPortal(<MapPicker initial={place} onClose={() => setMap(false)}
        onPick={(lat, lon) => { setMap(false); go({ name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon }) }} />, document.body)}
    </>
  )
}
