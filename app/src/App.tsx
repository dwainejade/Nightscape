import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { EngineHost } from './passes/EngineHost'
import { Panel } from './ui/Panel'
import { useSettings } from './store/settings'

export function App() {
  const [progress, setProgress] = useState(0)
  const fade = useSettings((s) => s.fade)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return // typing in a field
      const s = useSettings.getState()
      if (e.key === 'g' || e.key === 'G') s.setPanelOpen(!s.panelOpen)
      else if (e.key === 'Escape') s.setPanelOpen(false)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <>
      <Canvas
        dpr={[1, 2]}
        frameloop="always"
        gl={{ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
        style={{ position: 'fixed', inset: 0 }}
      >
        <EngineHost onProgress={setProgress} />
      </Canvas>
      {progress < 1 && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#9cb', font: '14px system-ui', pointerEvents: 'none' }}>
          Lighting the clouds... {Math.round(progress * 100)}%
        </div>
      )}
      <div style={{ position: 'fixed', inset: 0, background: '#000', opacity: fade, transition: 'opacity 0.45s ease', pointerEvents: 'none', zIndex: 4 }} />
      <Panel />
    </>
  )
}
