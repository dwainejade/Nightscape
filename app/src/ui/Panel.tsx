import type { CSSProperties } from 'react'
import { PlaceTab } from './PlaceTab'
import { CLOUD_CONTROLS, CLOUD_PRESETS, GRADE_CONTROLS, GRADE_PRESETS, useSettings } from '../store/settings'

const chip = (on: boolean): CSSProperties => ({
  background: on ? '#2a6' : '#0006', color: 'inherit', border: '1px solid #fff3', borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
})
const row: CSSProperties = { display: 'grid', gridTemplateColumns: '98px minmax(0, 1fr) 44px', alignItems: 'center', gap: 6, marginTop: 4 }

function CloudsTab() {
  const { clouds, setClouds, applyCloudPreset, rebake, morph } = useSettings()
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {Object.keys(CLOUD_PRESETS).map((n) => (
          <button key={n} onClick={() => applyCloudPreset(n)} style={chip(clouds.preset === n)}>{n}</button>
        ))}
      </div>
      {CLOUD_CONTROLS.map((c) => (
        <label key={c.key} style={row}>
          <span>{c.label}</span>
          <input type="range" style={{ width: '100%', minWidth: 0, margin: 0 }} min={c.min} max={c.max} step={c.step} value={clouds[c.key]}
            onChange={(e) => setClouds({ [c.key]: parseFloat(e.target.value) })} />
          <span style={{ textAlign: 'right' }}>{clouds[c.key].toFixed(c.step >= 1 ? 0 : 2)}</span>
        </label>
      ))}
      <div style={{ marginTop: 10, height: 14, opacity: 0.7, fontSize: 11 }}>
        {rebake >= 0 ? `Preparing the new sky... ${Math.round(rebake * 100)}%` : morph >= 0 ? `Clouds shifting... ${Math.round(morph * 100)}%` : 'Changes build up or disperse over the Change time; density is instant.'}
      </div>
    </>
  )
}

const fmtHour = (h: number) => {
  const m = Math.round(h * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const moonName = (p: number) => {
  const names = ['New', 'Crescent', 'First qtr', 'Gibbous', 'Full', 'Gibbous', 'Last qtr', 'Crescent']
  return names[Math.round(p * 8) % 8]
}
const TIMES: [string, number][] = [['Midnight', 0], ['Dawn', 5.75], ['Morning', 9], ['Noon', 12], ['Sunset', 18], ['Dusk', 19.25]]

function TimeTab() {
  const { tod, setTod, playing, setPlaying, dayLen, setDayLen, moonPhase, setMoonPhase, todMult, setTodMult, solarSync, setSolarSync } = useSettings()
  return (
    <>
      <div style={{ fontSize: 22, textAlign: 'center', margin: '4px 0 8px', fontVariantNumeric: 'tabular-nums' }}>{fmtHour(tod)}</div>
      <input type="range" min={0} max={24} step={0.01} value={tod} style={{ width: '100%', minWidth: 0, margin: 0 }}
        onChange={(e) => setTod(parseFloat(e.target.value))} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '10px 0' }}>
        <button onClick={() => setPlaying(!playing)} style={chip(playing)}>{playing ? 'Pause cycle' : 'Play cycle'}</button>
        {TIMES.map(([n, h]) => <button key={n} onClick={() => setTod(h)} style={chip(false)}>{n}</button>)}
      </div>
      <label style={row}>
        <span>Day length</span>
        <input type="range" min={10} max={600} step={5} value={dayLen} style={{ width: '100%', minWidth: 0, margin: 0 }}
          onChange={(e) => setDayLen(parseFloat(e.target.value))} />
        <span style={{ textAlign: 'right' }}>{dayLen}s</span>
      </label>
      <label style={row}>
        <span>Time speed</span>
        <input type="range" min={1} max={20} step={1} value={todMult} style={{ width: '100%', minWidth: 0, margin: 0 }}
          onChange={(e) => setTodMult(parseFloat(e.target.value))} />
        <span style={{ textAlign: 'right' }}>{todMult}x</span>
      </label>
      <div style={{ margin: '8px 0' }}>
        <button onClick={() => setSolarSync(!solarSync)} style={chip(solarSync)}>Sun follows longitude</button>
      </div>
      <label style={row}>
        <span>Moon phase</span>
        <input type="range" min={0} max={1} step={0.01} value={moonPhase} style={{ width: '100%', minWidth: 0, margin: 0 }}
          onChange={(e) => setMoonPhase(parseFloat(e.target.value))} />
        <span style={{ textAlign: 'right' }}>{moonName(moonPhase)}</span>
      </label>
      <div style={{ marginTop: 10, opacity: 0.7, fontSize: 11, lineHeight: 1.4 }}>
        Seconds of real time for a full 24 hours (divided by Time speed). The clock is the local solar time where you started; with Sun follows longitude on, flying east or west moves the sun. The sun rises in the east at 06:00 and sets at 18:00. Cloud and ground lighting in daytime is an approximation of the baked moonlight.
      </div>
    </>
  )
}

function ColourTab() {
  const { grade, setGrade, applyPreset } = useSettings()
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {Object.keys(GRADE_PRESETS).map((n) => (
          <button key={n} onClick={() => applyPreset(n)} style={chip(grade.preset === n)}>{n}</button>
        ))}
      </div>
      {GRADE_CONTROLS.map((c, i) =>
        c.sec ? (
          <div key={i} style={{ marginTop: 10, opacity: 0.6, textTransform: 'uppercase', fontSize: 10 }}>{c.sec}</div>
        ) : (
          <label key={c.key} style={row}>
            <span>{c.label}</span>
            <input type="range" style={{ width: '100%', minWidth: 0, margin: 0 }} min={c.min} max={c.max} step={c.step} value={grade[c.key!] as number}
              onChange={(e) => setGrade({ [c.key!]: parseFloat(e.target.value), preset: 'Custom' })} />
            <span style={{ textAlign: 'right' }}>{(grade[c.key!] as number).toFixed(c.key === 'grain' ? 3 : 2)}</span>
          </label>
        ),
      )}
    </>
  )
}

export function Panel() {
  const { panelOpen, setPanelOpen, tab, setTab, manual, setManual } = useSettings()
  return (
    <>
    <div data-ui style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 5, color: '#cfe', font: '12px system-ui', display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => setManual(!manual)} style={{ ...chip(manual), padding: '4px 10px' }}>{manual ? 'Manual flight' : 'Auto flight'}</button>
      <span style={{ opacity: 0.6 }}>{manual ? 'drag: look · WASD: move · Q/E: down/up · Shift: fast · R: auto' : 'autopilot · drag or press WASD to take control'}</span>
    </div>
    <div data-ui style={{ position: 'fixed', top: 0, right: 0, bottom: panelOpen ? 0 : 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', color: '#cfe', font: '12px system-ui', zIndex: 5, pointerEvents: 'none' }}>
      <button onClick={() => setPanelOpen(!panelOpen)}
        style={{ ...chip(false), padding: '4px 10px', background: '#0008', margin: 12, marginBottom: panelOpen ? 0 : 12, pointerEvents: 'auto', flexShrink: 0 }}>
        {panelOpen ? 'Close' : 'Settings'}
      </button>
      {panelOpen && (
        <div style={{ pointerEvents: 'auto', boxSizing: 'border-box', width: 300, maxWidth: '100vw', flex: 1, minHeight: 0, margin: '8px 0 0', overflowX: 'hidden', overflowY: 'auto', padding: 12, background: '#050a0ccc', borderLeft: '1px solid #fff2', backdropFilter: 'blur(8px)' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setTab('place')} style={chip(tab === 'place')}>Place</button>
            <button onClick={() => setTab('time')} style={chip(tab === 'time')}>Time</button>
            <button onClick={() => setTab('clouds')} style={chip(tab === 'clouds')}>Clouds</button>
            <button onClick={() => setTab('colour')} style={chip(tab === 'colour')}>Colour</button>
          </div>
          {tab === 'place' ? <PlaceTab /> : tab === 'time' ? <TimeTab /> : tab === 'clouds' ? <CloudsTab /> : <ColourTab />}
        </div>
      )}
    </div>
    </>
  )
}
