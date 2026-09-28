import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import DetailBar from './components/DetailBar'
import { trips } from './data/trips'
import { MAP_STYLES } from './data/mapStyles'

// Layers icon — represents switchable map styles
const ICON_LAYERS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5l6.5 3.25L8 8 1.5 4.75 8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M1.5 8L8 11.25 14.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M1.5 11.25L8 14.5l6.5-3.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// Globe + check — represents the visited-countries overlay toggle
const ICON_VISITED = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.4 8.3l1.7 1.7 3.5-3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const MOBILE_QUERY = '(max-width: 720px)'

export default function App() {
  const [activeTrip, setActiveTrip] = useState(null)
  const [hoveredTrip, setHoveredTrip] = useState(null)
  const [mapStyle, setMapStyle] = useState(MAP_STYLES[0])
  const [listOpen, setListOpen] = useState(true)
  const listPref = useRef(true) // list visibility as last chosen via the toggle
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const [showVisited, setShowVisited] = useState(false)
  const styleMenuRef = useRef(null)
  const appRef = useRef(null)

  useEffect(() => {
    document.documentElement.classList.toggle('light', mapStyle.theme === 'light')
  }, [mapStyle.theme])

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return
      // Dismiss one layer at a time, topmost first, and stay out of the way
      // while someone is typing in the search box.
      if (styleMenuOpen) { setStyleMenuOpen(false); return }
      if (e.target instanceof HTMLInputElement) return
      handleDeselect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id, styleMenuOpen])

  useEffect(() => {
    if (!styleMenuOpen) return
    const onClickOutside = e => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target)) setStyleMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [styleMenuOpen])

  // Leaflet's attribution control lives bottom-right *inside* the map's
  // stacking context, so on mobile the bottom sheet paints straight over it —
  // and the Esri/OSM terms require it to stay visible. Publish the
  // sheet's height so the CSS can lift the attribution clear of it.
  useLayoutEffect(() => {
    const el = appRef.current
    if (!el) return
    const panel = el.querySelector('.lpanel')
    const measure = () => {
      const mobile = window.matchMedia(MOBILE_QUERY).matches
      const h = mobile && listOpen && panel ? panel.offsetHeight : 0
      el.style.setProperty('--ui-bottom', `${h}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (panel) ro.observe(panel)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [listOpen])

  // The journeys list gives way to the map while a trip is selected, and
  // comes back when the trip is closed — but only if the user had it open:
  // a list hidden via the toggle stays hidden. listPref tracks that choice;
  // selection only ever changes listOpen, never the preference.
  function handleSelect(trip) {
    const deselecting = activeTrip?.id === trip.id
    setActiveTrip(deselecting ? null : trip)
    setListOpen(deselecting ? listPref.current : false)
    // The panel slides out from under the pointer, so its rows may never see
    // a mouseleave — drop the hover highlight explicitly.
    setHoveredTrip(null)
  }

  function handleDeselect() {
    if (activeTrip) setListOpen(listPref.current)
    setActiveTrip(null)
    setHoveredTrip(null)
  }

  function toggleList() {
    listPref.current = !listOpen
    setListOpen(!listOpen)
  }

  return (
    <div className="app" ref={appRef}>
      <h1 className="sr-only">Travels — a map of every trip</h1>

      <div className="map-controls">
        <div className="style-menu" ref={styleMenuRef}>
          <button
            className={`style-menu-toggle${styleMenuOpen ? ' active' : ''}`}
            onClick={() => setStyleMenuOpen(o => !o)}
            aria-label="Map style"
            aria-haspopup="menu"
            aria-expanded={styleMenuOpen}
            title="Map style"
          >
            {ICON_LAYERS}
          </button>
          {styleMenuOpen && (
            <div className="style-menu-popover" role="menu" aria-label="Map style">
              {MAP_STYLES.map(s => (
                <button
                  key={s.id}
                  role="menuitemradio"
                  aria-checked={mapStyle.id === s.id}
                  className={`style-menu-item${mapStyle.id === s.id ? ' active' : ''}`}
                  onClick={() => { setMapStyle(s); setStyleMenuOpen(false) }}
                >{s.label}</button>
              ))}
            </div>
          )}
        </div>

        <button
          className={`visited-toggle${showVisited ? ' active' : ''}`}
          onClick={() => setShowVisited(v => !v)}
          role="switch"
          aria-checked={showVisited}
          aria-label="Visited-countries overlay"
          title="Visited countries"
        >
          {ICON_VISITED}
        </button>
      </div>

      <button
        className="mobile-list-toggle"
        onClick={toggleList}
        aria-expanded={listOpen}
        aria-controls="journeys-panel"
      >{listOpen ? 'Hide list' : `Journeys (${trips.length})`}</button>

      <MapView
        trips={trips}
        activeTrip={activeTrip}
        hoveredTrip={hoveredTrip}
        mapStyle={mapStyle}
        showVisited={showVisited}
        listOpen={listOpen}
        onSelect={handleSelect}
        onDeselect={handleDeselect}
      />

      <Sidebar
        trips={trips}
        activeTrip={activeTrip}
        onSelect={handleSelect}
        onHover={setHoveredTrip}
        open={listOpen}
      />

      <DetailBar trip={activeTrip} onClose={handleDeselect} />
    </div>
  )
}
