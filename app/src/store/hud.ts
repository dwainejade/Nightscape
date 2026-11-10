import { create } from 'zustand'

/** Live flight readout, written by the engine a few times a second (not saved). */
export interface Hud {
  mode: 'auto' | 'manual' | 'path'
  lat: number; lon: number
  city: string; state: string; cityKm: number; cityDir: string
  altM: number            // metres above the ground
  localHour: number       // local solar time, hours 0..24
  destName: string; destKm: number
  kmh: number
  orbit: boolean
}
export const useHud = create<{ hud: Hud | null }>(() => ({ hud: null }))
