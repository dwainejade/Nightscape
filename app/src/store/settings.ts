import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Vector3 } from 'three'

export interface Grade {
  preset: string
  exposure: number; temp: number; tint: number; sat: number; contrast: number
  shadowAmt: number; shadow: string; highAmt: number; high: string
  lift: number; rays: number; vignette: number; grain: number
}
type Preset = Omit<Grade, 'preset'>

export const GRADE_PRESETS: Record<string, Preset> = {
  'Teal Night': { exposure: 1.15, temp: -0.35, tint: 0.35, sat: 1.10, contrast: 1.05, shadowAmt: 0.50, shadow: '#0f8f86', highAmt: 0.25, high: '#c4ece2', lift: 0.70, rays: 1.0, vignette: 0.38, grain: 0.007 },
  'Moonlit Blue': { exposure: 1.12, temp: -0.10, tint: 0.00, sat: 1.00, contrast: 1.00, shadowAmt: 0.35, shadow: '#3b5c9c', highAmt: 0.15, high: '#fff0dc', lift: 0.30, rays: 1.0, vignette: 0.38, grain: 0.007 },
  'Golden Moon': { exposure: 1.15, temp: -0.10, tint: 0.05, sat: 1.00, contrast: 1.05, shadowAmt: 0.28, shadow: '#3d5a86', highAmt: 0.45, high: '#ffd8a0', lift: 0.30, rays: 1.2, vignette: 0.40, grain: 0.007 },
  'Deep Sea': { exposure: 1.05, temp: -0.60, tint: 0.50, sat: 1.25, contrast: 1.10, shadowAmt: 0.70, shadow: '#006a73', highAmt: 0.35, high: '#a3f3e4', lift: 0.95, rays: 0.9, vignette: 0.45, grain: 0.008 },
  Silver: { exposure: 1.20, temp: -0.05, tint: 0.00, sat: 0.25, contrast: 1.10, shadowAmt: 0.20, shadow: '#6b7a8c', highAmt: 0.00, high: '#ffffff', lift: 0.15, rays: 1.0, vignette: 0.40, grain: 0.009 },
}
export const GRADE_DEFAULT = 'Teal Night'

export interface GradeControl { sec?: string; key?: keyof Preset; label?: string; min?: number; max?: number; step?: number; color?: 'shadow' | 'high' }
export const GRADE_CONTROLS: GradeControl[] = [
  { sec: 'Light' },
  { key: 'exposure', label: 'Exposure', min: 0.4, max: 2.0, step: 0.01 },
  { key: 'temp', label: 'Temperature', min: -1, max: 1, step: 0.01 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
  { key: 'rays', label: 'Light shafts', min: 0, max: 2, step: 0.01 },
  { sec: 'Colour' },
  { key: 'sat', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0.7, max: 1.5, step: 0.01 },
  { key: 'shadowAmt', label: 'Shadow tint', min: 0, max: 1, step: 0.01, color: 'shadow' },
  { key: 'highAmt', label: 'Highlight tint', min: 0, max: 1, step: 0.01, color: 'high' },
  { key: 'lift', label: 'Night glow', min: 0, max: 1.5, step: 0.01 },
  { sec: 'Lens' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 0.8, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 0.03, step: 0.001 },
]

/** Cloud shape and look. Everything except density changes the baked shape and triggers a background re-bake. */
export interface Clouds {
  preset: string
  cover: number      // 0 clear .. 1 solid deck
  cumulus: number    // 0 none .. 1 many cumulus heaps
  storm: number      // 0 none .. 1 many cumulonimbus
  deckH: number      // deck altitude offset (world units)
  windDir: number    // degrees: direction anvils and heaps lean
  windStr: number    // lean strength
  density: number    // how opaque (live, no re-bake)
  speed: number      // seconds a change takes to build up or disperse (live)
}
export const CLOUD_DEFAULT: Omit<Clouds, "preset"> = { cover: 0.5, cumulus: 0.62, storm: 0.45, deckH: 0, windDir: -36.87, windStr: 1, density: 4, speed: 12 }
export const CLOUD_PRESETS: Record<string, Omit<Clouds, "preset">> = {
  Default: CLOUD_DEFAULT,
  Clear: { cover: 0.12, cumulus: 0.2, storm: 0, deckH: -1, windDir: -36.87, windStr: 0.6, density: 3.2, speed: 12 },
  Scattered: { cover: 0.3, cumulus: 0.95, storm: 0.1, deckH: -0.5, windDir: -36.87, windStr: 0.8, density: 4, speed: 12 },
  Overcast: { cover: 0.95, cumulus: 0.15, storm: 0, deckH: 0.8, windDir: -36.87, windStr: 0.6, density: 5, speed: 12 },
  Stormy: { cover: 0.65, cumulus: 0.5, storm: 0.95, deckH: 0, windDir: -36.87, windStr: 1.8, density: 4.5, speed: 12 },
}
export interface CloudControl { key: keyof Omit<Clouds, "preset">; label: string; min: number; max: number; step: number; live?: boolean }
export const CLOUD_CONTROLS: CloudControl[] = [
  { key: "cover", label: "Coverage", min: 0, max: 1, step: 0.01 },
  { key: "cumulus", label: "Cumulus heaps", min: 0, max: 1, step: 0.01 },
  { key: "storm", label: "Storm towers", min: 0, max: 1, step: 0.01 },
  { key: "deckH", label: "Deck altitude", min: -3, max: 2, step: 0.05 },
  { key: "windDir", label: "Wind direction", min: -180, max: 180, step: 1 },
  { key: "windStr", label: "Wind lean", min: 0, max: 2.5, step: 0.05 },
  { key: "density", label: "Density", min: 1.5, max: 8, step: 0.1, live: true },
  { key: "speed", label: "Change time (s)", min: 2, max: 60, step: 1, live: true },
]

interface SettingsState {
  grade: Grade
  clouds: Clouds
  morph: number // 0..1 while the clouds build up or disperse, -1 when still (not saved)
  rebake: number // 0..1 while the clouds re-bake after a shape change, -1 when idle (not saved)
  tab: "clouds" | "colour"
  panelOpen: boolean
  setClouds: (patch: Partial<Clouds>) => void
  applyCloudPreset: (name: string) => void
  setTab: (tab: "clouds" | "colour") => void
  setGrade: (patch: Partial<Grade>) => void
  applyPreset: (name: string) => void
  setPanelOpen: (open: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      grade: { preset: GRADE_DEFAULT, ...GRADE_PRESETS[GRADE_DEFAULT] },
      clouds: { preset: "Default", ...CLOUD_DEFAULT },
      rebake: -1,
      morph: -1,
      tab: "clouds",
      panelOpen: false,
      setClouds: (patch) => set((s) => ({ clouds: { ...s.clouds, ...patch, preset: patch.preset ?? "Custom" } })),
      applyCloudPreset: (name) => set({ clouds: { preset: name, ...CLOUD_PRESETS[name] } }),
      setTab: (tab) => set({ tab }),
      setGrade: (patch) => set((s) => ({ grade: { ...s.grade, ...patch } })),
      applyPreset: (name) => set({ grade: { preset: name, ...GRADE_PRESETS[name] } }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
    }),
    {
      name: 'nightscape:settings:v1',
      partialize: (s) => ({ grade: s.grade, clouds: s.clouds, tab: s.tab }),
      // fill any keys added since a saved version
      merge: (saved, cur) => ({ ...cur, tab: (saved as any)?.tab ?? cur.tab, grade: { ...cur.grade, ...((saved as any)?.grade ?? {}) }, clouds: { ...cur.clouds, ...((saved as any)?.clouds ?? {}) } }),
    },
  ),
)

export function hexToLinear(hex: string, v: Vector3) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.pow(x / 255, 2.2))
  return v.set(Math.max(c[0], 0.002), Math.max(c[1], 0.002), Math.max(c[2], 0.002))
}
