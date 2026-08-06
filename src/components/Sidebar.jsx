import { useEffect, useMemo, useRef, useState } from 'react'
import { tripDays, tripYear, formatDateRange, tripColor, tripCountries, tripCountriesLabel, kmCompact, extraVisitedCountries } from '../data/trips'

export default function Sidebar({ trips, activeTrip, onSelect, onHover, open }) {
  const rowRefs = useRef({})
  const [query, setQuery] = useState('')
  const [year, setYear] = useState('all')

  const years = useMemo(() => {
    const set = new Set(trips.map(tripYear))
    return [...set].sort((a, b) => b - a)
  }, [trips])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return trips
      .filter(t => {
        const matchesYear  = year === 'all' || tripYear(t) === Number(year)
        const matchesQuery = !q
          || t.name.toLowerCase().includes(q)
          || tripCountries(t).some(c => c.toLowerCase().includes(q))
        return matchesYear && matchesQuery
      })
      // Newest first. trips.js is only roughly ordered within a year, and the
      // year headings below assume year-contiguous rows — an out-of-order
      // entry would otherwise print the same year twice.
      .sort((a, b) => (a.dateStart < b.dateStart ? 1 : a.dateStart > b.dateStart ? -1 : 0))
  }, [trips, query, year])


  // extraVisitedCountries have no date, so they only count under "All years",
  // and are still subject to the search box like everything else.
  const q = query.trim().toLowerCase()
  const visibleExtra = year === 'all'
    ? extraVisitedCountries.filter(c => !q || c.toLowerCase().includes(q))
    : []

  const countryCount  = new Set([...filtered.flatMap(tripCountries), ...visibleExtra]).size
  const totalDays     = filtered.reduce((s, t) => s + tripDays(t), 0)
  const totalKm       = filtered.reduce((s, t) => s + (t.kmTotal || 0), 0)

  // Keep the list in sync when a trip is selected from the map
  useEffect(() => {
    if (activeTrip) {
      rowRefs.current[activeTrip.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeTrip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Which rows start a new year block — worked out up front rather than by
  // mutating a counter while mapping over the rows.
  const rows = useMemo(
    () => filtered.map((trip, i) => ({
      trip,
      year: tripYear(trip),
      startsYear: i === 0 || tripYear(trip) !== tripYear(filtered[i - 1]),
    })),
    [filtered]
  )

  return (
    <aside
      id="journeys-panel"
      aria-label="Journeys"
      className={`lpanel${open ? '' : ' closed'}`}
    >
      <div className="lpanel-head">
        <div className="lph-stats">
          <div className="lph-stat">
            <div className="lph-stat-v">{filtered.length}</div>
            <div className="lph-stat-l">Trips</div>
          </div>
          <div className="lph-stat">
            <div className="lph-stat-v">{countryCount}</div>
            <div className="lph-stat-l">Countries</div>
          </div>
          <div className="lph-stat">
            <div className="lph-stat-v">{totalDays}</div>
            <div className="lph-stat-l">Days</div>
          </div>
          <div className="lph-stat">
            <div className="lph-stat-v">{kmCompact(totalKm)}</div>
            <div className="lph-stat-l">Km</div>
          </div>
        </div>
      </div>

      <div className="lfilters">
        <input
          type="search"
          className="lfilter-search"
          placeholder="Search trips…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search trips"
        />
        <select
          className="lfilter-year"
          value={year}
          onChange={e => setYear(e.target.value)}
          aria-label="Filter by year"
        >
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="jscroll">
        {filtered.length === 0 && visibleExtra.length === 0 && (
          <div className="jempty">No trips match.</div>
        )}
        {rows.map(({ trip, year: y, startsYear }) => {
          const color      = tripColor(trip.id)
          const isSelected = activeTrip?.id === trip.id

          return (
            <div key={trip.id}>
              {startsYear && <div className="jyear">{y}</div>}
              <button
                ref={el => { rowRefs.current[trip.id] = el }}
                className={`jrow${isSelected ? ' sel-trip' : ''}`}
                style={isSelected ? { '--sel-color': color } : undefined}
                aria-current={isSelected || undefined}
                onClick={() => onSelect(trip)}
                onMouseEnter={() => onHover(trip)}
                onMouseLeave={() => onHover(null)}
              >
                <div className="jcat-dot" style={{ background: color }} />
                <div className="jinfo">
                  <div className="jname">{trip.name}</div>
                  <div className="jmeta" title={tripCountriesLabel(trip)}>
                    {tripCountriesLabel(trip)} · {formatDateRange(trip.dateStart, trip.dateEnd)}
                  </div>
                </div>
                <div className="jkm">{kmCompact(trip.kmTotal)}</div>
              </button>
            </div>
          )
        })}

        {visibleExtra.length > 0 && (
          <div className="jrow jrow-extra">
            <div className="jcat-dot jcat-dot-neutral" />
            <div className="jinfo">
              <div className="jname">Also visited</div>
              <div className="jmeta" title={visibleExtra.join(', ')}>
                {visibleExtra.join(', ')}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
