// Place search through OpenStreetMap's Nominatim. Its usage policy allows light interactive use
// (one request at a time, no search-as-you-type), so the UI only searches on submit.
export interface PlaceHit { name: string; lat: number; lon: number }

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const q = query.trim()
  if (!q) return []
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const rows: { display_name: string; lat: string; lon: string }[] = await res.json()
  return rows.map((r) => ({ name: r.display_name.split(', ').slice(0, 3).join(', '), lat: parseFloat(r.lat), lon: parseFloat(r.lon) }))
}
