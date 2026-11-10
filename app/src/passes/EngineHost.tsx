import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Engine } from '../engine/engine'
import { useSettings } from '../store/settings'

declare global { interface Window { __cloudScene?: any } }

/** Owns the Engine and renders it each frame. A positive useFrame priority makes R3F skip its own render. */
export function EngineHost({ onProgress }: { onProgress: (p: number) => void }) {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const engine = useRef<Engine | null>(null)
  const lastP = useRef(-1)

  useEffect(() => {
    const e = new Engine(gl)
    engine.current = e
    e.resize(size.width, size.height, dpr)
    window.__cloudScene = {
      advance: (dt: number) => e.advance(dt), settings: useSettings, timings: () => e.timings, engine: e,
      // long-distance flight helpers: teleport(lat, lon), flyTo(lat, lon, {speed, alt}), flyRoute([[lat, lon], ...]), setSpeed(mult),
      // info(), perfStart() / perfStop(), setCloudVariety(a, b)
      teleport: e.teleport.bind(e), flyTo: e.flyTo.bind(e), flyRoute: e.flyRoute.bind(e), setSpeed: e.setSpeed.bind(e), info: e.info.bind(e),
      perfStart: e.perfStart.bind(e), perfStop: e.perfStop.bind(e), setCloudVariety: e.setCloudVariety.bind(e),
    }
    return () => { e.dispose(); engine.current = null; delete window.__cloudScene }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl])

  useEffect(() => { engine.current?.resize(size.width, size.height, dpr) }, [size.width, size.height, dpr])

  useFrame((_, delta) => {
    const e = engine.current
    if (!e) return
    e.step(delta)
    const p = e.baked ? 1 : e.progress
    if (p !== lastP.current) { lastP.current = p; onProgress(p) }
  }, 1)
  return null
}
