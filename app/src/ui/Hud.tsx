import { useHud } from '../store/hud'
import { useSettings } from '../store/settings'

const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`
const dm = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`
const km = (v: number) => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1))

/** Small flight readout: where you are, what is nearby, the local time and where the autopilot is going. */
export function Hud() {
  const hud = useHud((s) => s.hud)
  const on = useSettings((s) => s.hudOn)
  if (!on || !hud) return null
  const alt = hud.altM >= 1000 ? `${(hud.altM / 1000).toFixed(1)} km` : `${Math.round(hud.altM)} m`
  return (
    <div data-ui style={{ position: 'fixed', left: 12, top: 12, zIndex: 3, color: '#cfe', font: '12px/1.45 system-ui', pointerEvents: 'none', textShadow: '0 1px 3px #000a', opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ fontSize: 14 }}>
        {hud.city ? (hud.cityKm < 30 ? `Over ${hud.city}, ${hud.state}` : `${Math.round(hud.cityKm)} km ${hud.cityDir} of ${hud.city}, ${hud.state}`) : 'Open country'}
      </div>
      <div>{dm(hud.lat, 'N', 'S')} · {dm(hud.lon, 'E', 'W')} · {alt} up · {hm(hud.localHour)} local</div>
      {hud.destName && hud.mode === 'auto' && <div style={{ opacity: 0.8 }}>{hud.orbit ? 'Circling' : 'To'} {hud.destName} · {km(hud.destKm)} km · {Math.round(hud.kmh).toLocaleString()} km/h</div>}
      {hud.mode === 'manual' && <div style={{ opacity: 0.8 }}>Manual flight · R: autopilot{hud.destName ? ` to ${hud.destName}` : ''}</div>}
    </div>
  )
}
