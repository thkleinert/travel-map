// Formatting and colour logic for trips — no trip data of its own, so the demo
// dataset (demo/trips.js) can share exactly this implementation without pulling
// the real travel log into its bundle.

// ── Dates ────────────────────────────────────────────────────────────────────
// `new Date('2015-01-01')` is UTC midnight, but getFullYear()/toLocaleDateString()
// read local time — so west of UTC every trip starting on a Jan 1st would be
// grouped, filtered and labelled under the previous year. Everything below
// therefore stays in UTC end to end.

const DAY_MS = 86_400_000

function parseDay(iso) {
  return new Date(`${iso}T00:00:00Z`)
}

export function tripDays(trip) {
  const ms = parseDay(trip.dateEnd) - parseDay(trip.dateStart)
  return Math.round(ms / DAY_MS) + 1
}

// The year a trip is grouped and filtered by — its start year.
export function tripYear(trip) {
  return parseDay(trip.dateStart).getUTCFullYear()
}

export function formatDateRange(dateStart, dateEnd) {
  const s = parseDay(dateStart)
  const e = parseDay(dateEnd)
  const mo = d => d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const yr = d => d.getUTCFullYear()
  if (yr(s) !== yr(e)) return `${mo(s)} ${yr(s)} – ${mo(e)} ${yr(e)}`
  if (mo(s) !== mo(e)) return `${mo(s)} – ${mo(e)} ${yr(e)}`
  return `${mo(e)} ${yr(e)}`
}

// ── Countries ────────────────────────────────────────────────────────────────

// Every country visited on a trip, in travel order (may repeat, e.g. a trip
// that passes back through a country it already left).
export function tripCountries(trip) {
  return trip.countries
}

// Countries for display — deduplicated, first-appearance order.
export function tripCountriesLabel(trip) {
  return [...new Set(trip.countries)].join(', ')
}

// ── Per-trip colour palette ──────────────────────────────────────────────────
// A trip may pin its colour with an explicit `color` field; otherwise colours
// are assigned from the palette by position.

export const PALETTE = [
  '#4FA8FF', '#4ADEAE', '#FB923C', '#A78BFA', '#F472B6',
  '#34D399', '#FBBF24', '#60A5FA', '#C084FC', '#2DD4BF',
  '#F87171', '#A3E635',
]

// Builds the id → colour lookup once for a given trip list.
export function colorLookup(trips) {
  const byId = new Map(trips.map((t, i) => [t.id, t.color ?? PALETTE[i % PALETTE.length]]))
  return tripId => byId.get(tripId) ?? PALETTE[0]
}

// ── Distance formatting ──────────────────────────────────────────────────────
// A trip added before `npm run km` has run has no kmTotal yet — show a dash
// rather than "NaN" (or throwing in kmFull).

export function kmCompact(km) {
  if (!Number.isFinite(km)) return '–'
  return km >= 1000 ? (km / 1000).toFixed(1) + 'k' : String(km)
}

export function kmFull(km) {
  if (!Number.isFinite(km)) return '– km'
  return km.toLocaleString('en-GB') + ' km'
}
