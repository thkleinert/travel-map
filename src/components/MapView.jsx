import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, Marker, Pane, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { HOME, tripColor, tripCountries, extraVisitedCountries } from '../data/trips'
import { SmoothWheelZoom } from './smoothWheelZoom'
import routeVersions from 'virtual:route-versions'
import { suggestName } from '../edit/editApi'

// Visited-countries "scratch map" overlay — a neutral tint, independent of
// any single trip's color, so it reads as background context rather than
// competing with the route colors.
const VISITED_STYLE = {
  dark:  { fillColor: '#F0F6FC', fillOpacity: 0.16, color: '#F0F6FC', weight: 1, opacity: 0.5 },
  light: { fillColor: '#1C2128', fillOpacity: 0.13, color: '#1C2128', weight: 1, opacity: 0.42 },
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const LINE_STYLES = {
  on:    { weight: 2.8, alpha: 1 },
  hover: { weight: 2.6, alpha: 0.85 },
  dim:   { weight: 1.8, alpha: 0.32 },
  off:   { weight: 1,   alpha: 0.08 },
}

// react-leaflet diffs the `style` prop by identity and calls setStyle() on
// every change, so a fresh object per render would restyle all 28 route
// layers on every hover and zoom. Only a handful of color/state pairs exist.
const routeStyleCache = new Map()

function routeStyle(color, state) {
  const key = `${color}|${state}`
  if (!routeStyleCache.has(key)) {
    const s = LINE_STYLES[state]
    routeStyleCache.set(key, {
      color: s.alpha === 1 ? color : hexToRgba(color, s.alpha),
      weight: s.weight,
      opacity: 1,
    })
  }
  return routeStyleCache.get(key)
}

const casingStyleCache = new Map()

function casingStyle(casing, state) {
  const key = `${casing}|${state}`
  if (!casingStyleCache.has(key)) {
    casingStyleCache.set(key, {
      color: casing,
      weight: LINE_STYLES[state].weight + 1.8,
      opacity: state === 'on' ? 1 : 0.55,
    })
  }
  return casingStyleCache.get(key)
}

// Users who ask for less motion get instant view changes instead of glides.
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Icons are cached — only a handful of color/size/opacity combos exist,
// and returning the same object lets react-leaflet skip setIcon calls.
const iconCache = new Map()

// `edit` adds a ring and a grab cursor: in edit mode the active trip's stops
// are draggable, and need to read as handles rather than decoration.
function stopIcon(color, size, opacity, edit = false) {
  const key = `${color}|${size}|${opacity}|${edit}`
  if (!iconCache.has(key)) {
    iconCache.set(key, L.divIcon({
      className: edit ? 'stop-edit' : '',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:${opacity}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }))
  }
  return iconCache.get(key)
}

const homeIcon = L.divIcon({
  className: '',
  html: `<div class="mkr"><div class="mkr-ring home"></div></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
})

// Default (world) view — also the zoom-out target when a trip is deselected
const DEFAULT_BOUNDS = [[-15, -125], [65, 150]]

const MOBILE_QUERY = '(max-width: 720px)'

// The journeys panel and detail card float *over* the map, so fitting a
// bounds to the full container hides half of it behind them. These insets
// aim the fit at the space actually left visible: the panel sits left on
// desktop and bottom (sheet) on mobile; the detail card always bottom.
// offsetWidth/Height are used rather than getBoundingClientRect so a
// mid-transition slide doesn't feed a moving target into the fit.
function uiInsets(listOpen, activeTrip) {
  const edge   = 16 // breathing room along the container edges
  const mobile = window.matchMedia(MOBILE_QUERY).matches
  const panel  = listOpen ? document.querySelector('.lpanel') : null
  const dbar   = activeTrip ? document.querySelector('.dbar') : null
  const ebar   = document.querySelector('.editbar')

  const left   = panel && !mobile ? panel.offsetLeft + panel.offsetWidth : 0
  const bottom = (panel && mobile ? panel.offsetHeight : 0) +
                 (dbar ? dbar.offsetHeight + 12 : 0)

  return {
    // the floating top buttons only need clearing when a route is being
    // framed; the world view reads better centred edge to edge
    paddingTopLeft:     [left + edge, edge + (ebar ? ebar.offsetTop + ebar.offsetHeight : activeTrip ? 40 : 0)],
    paddingBottomRight: [edge, bottom + edge],
  }
}

// Plain fitBounds centres DEFAULT_BOUNDS in the visible box, and those
// bounds reach further north than south — so whenever the map fits with
// height to spare (panel hidden), the tile band ends up sitting low. Work
// out the view by hand: same zoom fitBounds would pick, but anchored on
// the equator instead of the bounds' centre while the whole band fits.
function defaultView(map, insets) {
  const [padL, padT] = insets.paddingTopLeft
  const [padR, padB] = insets.paddingBottomRight
  const size = map.getSize()
  const b    = L.latLngBounds(DEFAULT_BOUNDS)
  const zoom = map.getBoundsZoom(b, false, L.point(padL + padR, padT + padB))

  // insets larger than the container (a very short viewport, or a sheet taller
  // than expected) make getBoundsZoom return NaN, which would throw further
  // down in unproject/setView — leave the current view alone instead.
  if (!Number.isFinite(zoom)) return null

  const nw   = map.project(b.getNorthWest(), zoom)
  const se   = map.project(b.getSouthEast(), zoom)
  const top    = map.project([85.0511, 0], zoom).y  // the tile band's edges
  const bottom = map.project([-85.0511, 0], zoom).y
  const boxH   = Math.max(1, size.y - padT - padB)

  // What lands at the centre of the visible box. Centre the tile band when
  // it fits; otherwise keep the bounds' centre (which favours the northern
  // hemisphere, where most trips are) but never far enough to expose blank
  // space past a pole.
  const anchorY = bottom - top <= boxH
    ? (top + bottom) / 2
    : Math.min(Math.max((nw.y + se.y) / 2, top + boxH / 2), bottom - boxH / 2)

  const anchor = L.point((nw.x + se.x) / 2, anchorY)
  const box    = L.point((padL + size.x - padR) / 2, (padT + size.y - padB) / 2)

  return { center: map.unproject(anchor.add(size.divideBy(2)).subtract(box), zoom), zoom }
}

function ViewController({ activeTrip, bounds, listOpen, editing }) {
  const map = useMap()
  const prevId  = useRef(null)
  const mounted = useRef(false)

  // Frames whatever should be on screen right now — the selected trip's track,
  // or the world view — into the space the panels leave visible.
  const applyView = useCallback((animate, duration = 1.2) => {
    const insets = uiInsets(listOpen, activeTrip)
    const glide  = animate && !prefersReducedMotion()

    if (activeTrip) {
      if (bounds?.isValid()) {
        const opts = { ...insets, maxZoom: 9 }
        if (glide) map.flyToBounds(bounds, { ...opts, duration })
        else map.fitBounds(bounds, { ...opts, animate: false })
      } else if (activeTrip.destCoords) {
        if (glide) map.flyTo(activeTrip.destCoords, 5, { duration })
        else map.setView(activeTrip.destCoords, 5, { animate: false })
      }
      return
    }

    const view = defaultView(map, insets)
    if (!view) return
    if (glide) map.flyTo(view.center, view.zoom, { duration })
    else map.setView(view.center, view.zoom, { animate: false })
  }, [map, activeTrip, bounds, listOpen])

  // Selection changed — or the selected trip's geometry only just finished
  // loading. `bounds` is in the deps for that second case: click a trip whose
  // 12 MB track is still in flight and the first pass can only fall back to
  // destCoords, so the fit has to be redone once the real bounds arrive.
  useEffect(() => {
    if (activeTrip || prevId.current) applyView(true, activeTrip ? 1.2 : 0.6)
    prevId.current = activeTrip?.id ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id, bounds])

  // The panel appearing/disappearing frees or claims space — re-frame into
  // what's left. On mount this is what applies the insets to the initial view.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      applyView(false)
      return
    }
    // brisker than a selection fly-to: the panel itself slides in 0.25s, so a
    // long map glide leaves the two visibly out of step
    applyView(true, 0.5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOpen])

  // The edit bar claims the top edge (see uiInsets) — re-frame once it has
  // rendered, so no stop of the selected trip is left underneath it.
  const editMounted = useRef(false)
  useEffect(() => {
    if (!editMounted.current) { editMounted.current = true; return }
    if (activeTrip) applyView(true, 0.5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // Rotation / window resize changes both the container and the sheet height
  useEffect(() => {
    const onResize = () => {
      // A mobile keyboard opening also fires resize; don't yank the map out
      // from under someone typing in the search box.
      if (document.activeElement?.closest?.('.lfilters')) return
      applyView(false)
    }
    map.on('resize', onResize)
    return () => map.off('resize', onResize)
  }, [map, applyView])

  return null
}

// Replaces Leaflet's stepped scrollWheelZoom (disabled on the MapContainer)
function SmoothWheel() {
  const map = useMap()
  useEffect(() => {
    const handler = new SmoothWheelZoom(map)
    handler.enable()
    return () => handler.disable()
  }, [map])
  return null
}

// +/− buttons. Rendered inside the map container so they can reach the map,
// which means map click/dblclick/drag handlers would see their clicks too —
// hence disableClickPropagation (a click would otherwise deselect the trip).
function ZoomButtons() {
  const map = useMap()
  const ref = useRef(null)
  useEffect(() => {
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
  }, [])
  const zoom = delta => map.setZoom(map.getZoom() + delta, { animate: !prefersReducedMotion() })
  return (
    <div className="zoom-controls" ref={ref}>
      <button onClick={() => zoom(1)} aria-label="Zoom in" title="Zoom in">+</button>
      <button onClick={() => zoom(-1)} aria-label="Zoom out" title="Zoom out">−</button>
    </div>
  )
}

function MapEvents({ onMapClick, onZoom }) {
  useMapEvents({
    click: e => onMapClick(e.latlng),
    zoomend: e => onZoom(e.target.getZoom()),
  })
  return null
}

// Rename / delete form, shown in a popup on an editable stop
function StopForm({ stop, onRename, onDelete }) {
  const map = useMap()
  const [name, setName] = useState(stop.name ?? '')
  // Close and apply only once the click has finished dispatching. Leaflet
  // tells a popup click from a map click by walking up from the target; if
  // the popup is already gone from the DOM by then, the walk finds no popup
  // and the click also lands on the map — which in edit mode adds a stop.
  const done = action => setTimeout(() => { map.closePopup(); action?.() })
  const submit = e => {
    e.preventDefault()
    const trimmed = name.trim()
    done(trimmed && trimmed !== stop.name ? () => onRename(trimmed) : null)
  }
  return (
    <form className="stop-form" onSubmit={submit}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        aria-label="Stop name"
        placeholder="Stop name"
        autoFocus
      />
      <div className="stop-form-actions">
        <button type="button" className="danger" onClick={() => done(onDelete)}>Delete</button>
        <button type="submit">Rename</button>
      </div>
    </form>
  )
}

// Stop dots shrink when zoomed out so dense clusters don't fuse into blobs
function stopSize(zoom, isActive) {
  const base = zoom <= 3 ? 4 : zoom <= 6 ? 6 : 8
  return isActive ? base + 3 : base
}

export default function MapView({
  trips, activeTrip, hoveredTrip, mapStyle, showVisited, listOpen, onSelect, onDeselect,
  editing = false, stopOverrides = {}, onStopsChange,
}) {
  // { [tripId]: { lines, stops: [{ key, pos: [lat,lng], name, src, orig }], bounds: L.LatLngBounds } }
  // src is the stop's index among the file's Point features and orig its
  // position as loaded — edit mode uses both to write changes back safely.
  const [tripData, setTripData] = useState({})
  const [zoom, setZoom] = useState(2)
  // Reading `tripData` inside the loop below would only ever see the snapshot
  // the effect closed over, so in-flight//done ids are tracked in a ref
  // instead. Deliberately not cancelled on cleanup: StrictMode's double
  // invocation would then abort every request and the re-run would skip them
  // all as already-started, leaving the map empty.
  const requested = useRef(new Set())

  useEffect(() => {
    // The files land at 28 different times; collecting them into one state
    // update per frame keeps mount from re-rendering every route layer and
    // every marker once per file.
    let pending = null
    let frame = 0
    const flush = () => {
      frame = 0
      const batch = pending
      pending = null
      setTripData(prev => ({ ...prev, ...batch }))
    }

    trips.forEach(async trip => {
      if (requested.current.has(trip.id)) return
      requested.current.add(trip.id)
      try {
        // ?v=<content hash> on builds: the URL changes whenever the file does
        const v   = routeVersions[trip.geojsonPath.replace(/^\//, '')]
        const res = await fetch(v ? `${trip.geojsonPath}?v=${v}` : trip.geojsonPath)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const raw = await res.json()

        let lines = raw
        const stops = []
        if (raw?.type === 'FeatureCollection') {
          lines = { ...raw, features: raw.features.filter(f => !f.geometry?.type.includes('Point')) }
          raw.features.forEach(f => {
            const name = f.properties?.name ?? null
            if (f.geometry?.type === 'Point') {
              // GeoJSON coords are [lng, lat]; Leaflet wants [lat, lng]
              const pos = [f.geometry.coordinates[1], f.geometry.coordinates[0]]
              const src = stops.length
              stops.push({ key: `${trip.id}:${src}`, pos, name, src, orig: pos })
            } else if (f.geometry?.type === 'MultiPoint') {
              // not editable (src: null would read as "new"), hence `fixed`
              f.geometry.coordinates.forEach((c, j) =>
                stops.push({ key: `${trip.id}:m${stops.length}:${j}`, pos: [c[1], c[0]], name, fixed: true }))
            }
          })
        }

        const bounds = L.geoJSON(lines).getBounds()
        stops.forEach(s => bounds.extend(s.pos))

        pending = { ...pending, [trip.id]: { lines, stops, bounds } }
        if (!frame) frame = requestAnimationFrame(flush)
      } catch (err) {
        // A path that doesn't exist is answered with the SPA's index.html and
        // a 200 by both Vite and Cloudflare Pages, so the JSON parse error
        // here is the only signal that a trip's geojsonPath is wrong.
        requested.current.delete(trip.id)
        console.warn(`Route data for "${trip.id}" (${trip.geojsonPath}) could not be loaded:`, err.message)
      }
    })
  }, [trips])

  // Marker click handlers have to keep the same identity across renders —
  // react-leaflet re-binds every listener when the `eventHandlers` object
  // changes, and there are ~425 stop markers.
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect })
  const clickHandlers = useMemo(() => {
    const map = {}
    trips.forEach(trip => { map[trip.id] = { click: () => onSelectRef.current?.(trip) } })
    return map
  }, [trips])

  const stopsOf = id => stopOverrides[id] ?? tripData[id]?.stops

  // Edit mode acts on the selected trip only; everything else behaves as usual
  const editTrip = editing && activeTrip && tripData[activeTrip.id]
    && !tripData[activeTrip.id].stops.some(s => s.fixed) ? activeTrip : null
  const editStops = editTrip ? stopsOf(editTrip.id) : null
  const updateStops = next => onStopsChange?.(editTrip.id, editStops, next)
  const patchStop = (key, patch) => updateStops(editStops.map(s => (s.key === key ? { ...s, ...patch } : s)))

  // Clicking the map adds a stop there while editing, instead of deselecting.
  // The name is a reverse-geocode suggestion — rename it from its popup.
  // The lookup is async, so the stop is appended to whatever the stops are
  // once it returns (via the ref), not to the render the click happened in.
  const latest = useRef(null)
  useEffect(() => { latest.current = { editTrip, editStops, onStopsChange } })
  const newStopId = useRef(0)
  async function handleMapClick(latlng) {
    if (!editTrip) { onDeselect(); return }
    const pos  = [latlng.lat, latlng.lng]
    const trip = editTrip
    const key  = `${trip.id}:n${++newStopId.current}`
    const name = (await suggestName(pos)) ?? 'New stop'
    const now  = latest.current
    // the trip may have been closed while the name lookup was in flight
    if (now.editTrip?.id !== trip.id) return
    now.onStopsChange?.(trip.id, now.editStops, [...now.editStops, { key, pos, name, src: null, orig: pos }])
  }

  const hoverData = hoveredTrip && hoveredTrip.id !== activeTrip?.id
    ? tripData[hoveredTrip.id]
    : null

  // World country boundaries (world-atlas + topojson-client) are a sizable
  // payload — code-split and load them after the initial render rather than
  // bundling into the main chunk.
  const [visitedGeoJSON, setVisitedGeoJSON] = useState(null)
  const visitedCountries = useMemo(
    () => new Set([...trips.flatMap(tripCountries), ...extraVisitedCountries]),
    [trips]
  )

  // Only fetched once the overlay is actually switched on — it is ~380 kB
  // gzipped and the overlay is off by default.
  useEffect(() => {
    if (!showVisited || visitedGeoJSON) return
    let cancelled = false
    import('../data/worldCountries')
      .then(({ visitedCountriesGeoJSON }) => {
        if (!cancelled) setVisitedGeoJSON(visitedCountriesGeoJSON(visitedCountries))
      })
      .catch(err => {
        // A stale cached index.html can point at an async chunk hash that no
        // longer exists after a fresh deploy — fails silently otherwise.
        console.error('Failed to load visited-countries overlay:', err)
      })
    return () => { cancelled = true }
  }, [showVisited, visitedGeoJSON, visitedCountries])

  return (
    <div className={`map-container${editTrip ? ' editing' : ''}`}>
      <MapContainer
        bounds={DEFAULT_BOUNDS}
        style={{ position: 'absolute', inset: 0 }}
        zoomControl={false}
        /* quarter-step zoom: whole-number steps overshoot the fit on narrow
           viewports and clip the edges of the bounds */
        zoomSnap={0.25}
        scrollWheelZoom={false}
      >
        <TileLayer
          key={mapStyle.id}
          url={mapStyle.url}
          attribution={mapStyle.attr}
          subdomains={mapStyle.sub}
          maxZoom={mapStyle.maxZoom}
          maxNativeZoom={mapStyle.maxNativeZoom}
        />

        {/* Visited-countries overlay — a manual scratch map of every country
            any trip has touched, regardless of selection. Bottom-most pane of
            the three, so toggling it on never covers the routes. */}
        <Pane name="visited-countries" style={{ zIndex: 398 }}>
          {showVisited && visitedGeoJSON && (
            <GeoJSON
              key={`visited-${mapStyle.theme}`}
              data={visitedGeoJSON}
              style={VISITED_STYLE[mapStyle.theme]}
              interactive={false}
            />
          )}
        </Pane>

        <ViewController
          activeTrip={activeTrip}
          bounds={tripData[activeTrip?.id]?.bounds}
          listOpen={listOpen}
          editing={editing}
        />
        <MapEvents onMapClick={handleMapClick} onZoom={setZoom} />
        <SmoothWheel />
        <ZoomButtons />

        {/* Casing — halo under routes on busy or pale tile styles.
            It lives in its own pane below the default overlay pane: sharing
            one pane makes paint order depend on which layer Leaflet created
            last, and a casing re-created after a style switch would then be
            drawn on top of the route it is supposed to sit behind.
            The keys deliberately carry no state either: react-leaflet applies
            a changed `style` prop with setStyle(), so keying on the state
            would tear down and re-parse every track on each select. */}
        <Pane name="route-casing" style={{ zIndex: 399 }}>
          {mapStyle.casing && trips.map(trip => {
            const data = tripData[trip.id]
            if (!data || (activeTrip && trip.id !== activeTrip.id)) return null
            const state = activeTrip ? 'on' : 'dim'
            return (
              <GeoJSON
                key={`casing-${trip.id}-${mapStyle.id}`}
                data={data.lines}
                style={casingStyle(mapStyle.casing, state)}
              />
            )
          })}
        </Pane>

        {/* Routes */}
        {trips.map(trip => {
          const data = tripData[trip.id]
          if (!data) return null
          const state = !activeTrip ? 'dim' : trip.id === activeTrip.id ? 'on' : 'off'
          return (
            <GeoJSON
              key={`line-${trip.id}`}
              data={data.lines}
              style={routeStyle(tripColor(trip.id), state)}
            />
          )
        })}

        {/* Hovered trip highlight (from sidebar hover) */}
        {hoverData && (
          <GeoJSON
            key={`hover-${hoveredTrip.id}`}
            data={hoverData.lines}
            style={routeStyle(tripColor(hoveredTrip.id), 'hover')}
          />
        )}

        {/* Stop markers */}
        {trips.map(trip => {
          if (trip.id === editTrip?.id) return null // drawn editable below
          const isActive = trip.id === activeTrip?.id
          const opacity  = isActive ? 0.95 : activeTrip ? 0.12 : 0.5
          const icon     = stopIcon(tripColor(trip.id), stopSize(zoom, isActive), opacity)
          const stops    = stopsOf(trip.id)
          // Nothing to place a marker at: no stops loaded and no fallback
          // coordinate. `position={undefined}` would throw inside Leaflet and
          // take the whole map down with it.
          if (!stops?.length && !trip.destCoords) return null
          const coords   = stops?.length ? stops : [{ pos: trip.destCoords, name: null }]
          return coords.map((s, i) => (
            <Marker
              key={s.key ?? `stop-${trip.id}-${i}`}
              position={s.pos}
              icon={icon}
              // no `alt`: Leaflet only applies that to <img> icons, and these
              // are divIcons. The stop name is on the Tooltip below; the
              // journeys list is the keyboard/screen-reader path into a trip.
              keyboard={false}
              eventHandlers={clickHandlers[trip.id]}
            >
              <Tooltip className="stop-tip" direction="top" offset={[0, -6]} opacity={1}>
                {s.name || trip.name}
              </Tooltip>
            </Marker>
          ))
        })}

        {/* Editable stops of the selected trip: drag to move, click for the
            rename/delete popup. Plain handlers are fine here — it's one
            trip's worth of markers, not all ~425. */}
        {editTrip && editStops.map(s => (
          <Marker
            key={s.key}
            position={s.pos}
            icon={stopIcon(tripColor(editTrip.id), stopSize(zoom, true) + 4, 1, true)}
            draggable
            keyboard={false}
            eventHandlers={{
              // the popup shows the name already; the tooltip would sit under it
              popupopen: e => e.target.closeTooltip(),
              dragend: e => {
                const { lat, lng } = e.target.getLatLng()
                patchStop(s.key, { pos: [lat, lng] })
              },
            }}
          >
            <Tooltip className="stop-tip" direction="top" offset={[0, -8]} opacity={1}>
              {s.name || editTrip.name}
            </Tooltip>
            <Popup className="stop-popup" closeButton={false} offset={[0, -4]}>
              <StopForm
                stop={s}
                onRename={name => patchStop(s.key, { name })}
                onDelete={() => updateStops(editStops.filter(x => x.key !== s.key))}
              />
            </Popup>
          </Marker>
        ))}

        {/* Home marker */}
        <Marker position={HOME.coords} icon={homeIcon} title={`Home · ${HOME.label}`} alt="Home" keyboard={false} />
      </MapContainer>
    </div>
  )
}
