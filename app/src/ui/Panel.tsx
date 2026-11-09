import type { CSSProperties } from 'react'
import { CLOUD_CONTROLS, CLOUD_PRESETS, GRADE_CONTROLS, GRADE_PRESETS, useSettings } from '../store/settings'

const chip = (on: boolean): CSSProperties => ({
  background: on ? '#2a6' : '#0006', color: 'inherit', border: '1px solid #fff3', borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
})
const row: CSSProperties = { display: 'grid', gridTemplateColumns: '98px 1fr 44px', alignItems: 'center', gap: 6, marginTop: 4 }

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
          <input type="range" min={c.min} max={c.max} step={c.step} value={clouds[c.key]}
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
            <input type="range" min={c.min} max={c.max} step={c.step} value={grade[c.key!] as number}
              onChange={(e) => setGrade({ [c.key!]: parseFloat(e.target.value), preset: 'Custom' })} />
            <span style={{ textAlign: 'right' }}>{(grade[c.key!] as number).toFixed(c.key === 'grain' ? 3 : 2)}</span>
          </label>
        ),
      )}
    </>
  )
}

export function Panel() {
  const { panelOpen, setPanelOpen, tab, setTab } = useSettings()
  return (
    <div data-ui style={{ position: 'fixed', top: 12, right: 12, color: '#cfe', font: '12px system-ui', zIndex: 5 }}>
      <button onClick={() => setPanelOpen(!panelOpen)} style={{ ...chip(false), padding: '4px 10px', background: '#0008' }}>
        {panelOpen ? 'Close' : 'Settings'}
      </button>
      {panelOpen && (
        <div style={{ marginTop: 8, width: 280, maxHeight: '80vh', overflow: 'auto', padding: 12, background: '#050a0ccc', border: '1px solid #fff2', borderRadius: 8, backdropFilter: 'blur(8px)' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            <button onClick={() => setTab('clouds')} style={chip(tab === 'clouds')}>Clouds</button>
            <button onClick={() => setTab('colour')} style={chip(tab === 'colour')}>Colour</button>
          </div>
          {tab === 'clouds' ? <CloudsTab /> : <ColourTab />}
        </div>
      )}
    </div>
  )
}
