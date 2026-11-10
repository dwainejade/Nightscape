import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { searchPlaces, type PlaceHit } from '../geo/geocode'
import { useSettings } from '../store/settings'
import { loadCities, type City } from '../geo/cities'
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
  const { place, setPlace, placeStatus, placeInfo, apSpeed, setApSpeed, hudOn, setHudOn, tour, setTour, dest, setDest, manual, setManual } = useSettings()
  const [cities, setCities] = useState<City[]>([])
  const [cq, setCq] = useState('')
  useEffect(() => { loadCities().then((c) => setCities([...c].sort((a, b) => b.population - a.population))).catch(() => {}) }, [])
  const shown = useMemo(() => {
    const t = cq.trim().toLowerCase()
    return (t ? cities.filter((c) => `${c.name} ${c.state}`.toLowerCase().includes(t)) : cities).slice(0, 40)
  }, [cities, cq])
  const flyTo = (c: City) => {
    if (!place) { setPlace({ name: `${c.name}, ${c.state}`, lat: c.lat, lon: c.lon }); return } // no real ground yet: start there
    setTour(false); setDest(c); if (manual) setManual(false)
  }
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

      <div style={{ marginTop: 10, opacity: 0.6, textTransform: 'uppercase', fontSize: 10 }}>Autopilot</div>
      <label style={{ display: 'grid', gridTemplateColumns: '98px minmax(0, 1fr) 44px', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <span>Speed</span>
        <input type="range" min={1} max={10} step={0.5} value={apSpeed} style={{ width: '100%', minWidth: 0, margin: 0 }} onChange={(e) => setApSpeed(parseFloat(e.target.value))} />
        <span style={{ textAlign: 'right' }}>{apSpeed}x</span>
      </label>
      <div style={{ display: 'flex', gap: 4, margin: '6px 0', flexWrap: 'wrap' }}>
        <button onClick={() => setTour(!tour)} style={chip(tour)} disabled={!place}>Tour</button>
        <button onClick={() => setHudOn(!hudOn)} style={chip(hudOn)}>HUD</button>
        {manual && place && <button onClick={() => setManual(false)} style={chip(false)}>Resume autopilot</button>}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.4 }}>
        {!place ? 'Pick a real place (or a city below) and the autopilot flies city to city.' : tour ? 'Touring: nearest city next, a lap around each.' : dest ? `Heading for ${dest.name}, ${dest.state}.` : 'Cruising between cities.'}
      </div>
      <div style={{ marginTop: 6, opacity: 0.6, textTransform: 'uppercase', fontSize: 10 }}>Fly to a city</div>
      <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Filter cities..." onKeyDown={(e) => e.stopPropagation()}
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, background: '#0008', color: 'inherit', border: '1px solid #fff3', borderRadius: 4, padding: '4px 6px' }} />
      <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 4 }}>
        {shown.map((c) => (
          <button key={`${c.name},${c.state}`} onClick={() => flyTo(c)} style={{ ...chip(dest?.name === c.name && dest?.state === c.state), display: 'block', width: '100%', textAlign: 'left', marginBottom: 2 }}>
            {c.name}, {c.state} <span style={{ opacity: 0.5 }}>{(c.population / 1e6).toFixed(c.population >= 1e6 ? 1 : 2)}M</span>
          </button>
        ))}
        {!shown.length && <div style={{ opacity: 0.6, fontSize: 11 }}>{cities.length ? 'No match.' : 'Loading cities...'}</div>}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.85, lineHeight: 1.4 }}>
        {placeStatus === 'loading' && 'Fetching elevation...'}
        {placeStatus === 'error' && `Could not load: ${placeInfo}`}
        {placeStatus === 'ready' && place && <><b>{place.name}</b><br />{placeInfo}</>}
        {placeStatus === 'idle' && !place && 'Showing invented mountains. Search or pick a place to fly over real terrain.'}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, opacity: 0.5, lineHeight: 1.4 }}>
        Elevation: Terrarium (AWS Open Data). Colour: Sentinel-2 cloudless by EOX, contains modified Copernicus Sentinel data 2016 (CC BY 4.0). Search: OpenStreetMap Nominatim. Cities: US Census Bureau data (public domain). Lakes and rivers are read from the satellite colour; town lights and small-scale detail are generated.
      </div>

      {map && createPortal(<MapPicker initial={place} onClose={() => setMap(false)}
        onPick={(lat, lon) => { setMap(false); go({ name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon }) }} />, document.body)}
    </>
  )
}
