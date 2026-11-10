// City list for the autopilot and HUD. Format: array of { name, state, lon, lat, population } (`state` can hold a region
// or country in a world list). Current data: ~300 US cities from US Census data (public domain), public/cities.json.
export interface City { name: string; state: string; lon: number; lat: number; population: number }

const R = 6371008.8 // mean Earth radius, metres
const rad = Math.PI / 180

let cities: City[] = []
let loading: Promise<City[]> | null = null

export function loadCities(): Promise<City[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}cities.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`cities.json: ${r.status}`))))
    .then((j: City[]) => (cities = j.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))))
    .catch((e) => { loading = null; throw e })
  return loading
}
export const getCities = () => cities

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = lat1 * rad, p2 = lat2 * rad, dl = (lon2 - lon1) * rad
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
/** Initial great-circle bearing in radians, clockwise from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = lat1 * rad, p2 = lat2 * rad, dl = (lon2 - lon1) * rad
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))
}

export function nearestCity(lat: number, lon: number): { city: City; dist: number; bearing: number } | null {
  let best: City | null = null, bd = Infinity
  for (const c of cities) {
    // cheap reject on latitude before the trig
    if (Math.abs(c.lat - lat) * 111000 > bd) continue
    const d = distanceM(lat, lon, c.lat, c.lon)
    if (d < bd) { bd = d; best = c }
  }
  return best ? { city: best, dist: bd, bearing: bearing(best.lat, best.lon, lat, lon) } : null
}

/**
 * Next destination: a sizeable city 150-800 km away that was not visited recently, chosen at random, favouring bigger
 * and nearer ones. Falls back to the nearest other city when nothing qualifies (e.g. flying in from outside the list).
 */
export function pickNext(lat: number, lon: number, visited: string[], mode: 'random' | 'near' = 'random', rnd = Math.random): City | null {
  const key = (c: City) => `${c.name},${c.state}`
  const cand: { c: City; w: number }[] = []
  let nearest: City | null = null, nd = Infinity
  for (const c of cities) {
    if (visited.includes(key(c))) continue
    const d = distanceM(lat, lon, c.lat, c.lon)
    if (d < 20000) continue
    if (d < nd) { nd = d; nearest = c }
    if (d >= 150000 && d <= 800000 && c.population >= 150000) cand.push({ c, w: Math.sqrt(c.population) / (d / 300000) })
  }
  if (mode === 'near') {
    // a tour: the nearest sizeable city not visited yet
    let best: City | null = null, bd = Infinity
    for (const c of cities) {
      if (visited.includes(key(c)) || c.population < 200000) continue
      const d = distanceM(lat, lon, c.lat, c.lon)
      if (d > 20000 && d < bd) { bd = d; best = c }
    }
    if (best) return best
  }
  if (!cand.length) return nearest
  let t = rnd() * cand.reduce((s, x) => s + x.w, 0)
  for (const x of cand) { t -= x.w; if (t <= 0) return x.c }
  return cand[cand.length - 1].c
}
export const cityKey = (c: City) => `${c.name},${c.state}`
