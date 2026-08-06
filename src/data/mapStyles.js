// Tile styles selectable from the topbar.
// `theme` drives the UI panel palette (:root.light class).
// `casing` draws a halo polyline under routes on busy or pale imagery, so the
//   route colors (picked for dark tiles) keep their contrast; null = none.
// `maxZoom` is the deepest zoom the provider actually serves — going past it
//   just yields blank tiles.
// `sub` must always be set, even for URLs without a `{s}` placeholder: Leaflet
//   reads `subdomains.length` unconditionally, so passing undefined throws
//   inside getTileUrl and takes the whole map down.

export const MAP_STYLES = [
  {
    id:      'carto-dark',
    label:   'Dark',
    url:     'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    sub:     'abcd',
    attr:    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    theme:   'dark',
    casing:  null,
    maxZoom: 20,
  },
  {
    id:      'carto-light',
    label:   'Light',
    url:     'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    sub:     'abcd',
    attr:    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    theme:   'light',
    // the palette is tuned for dark tiles; without a casing the dimmed routes
    // all but disappear against the near-white basemap
    casing:  'rgba(0,0,0,0.30)',
    maxZoom: 20,
  },
  {
    id:      'esri-street',
    label:   'Street',
    url:     'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    sub:     'abc',
    attr:    '&copy; Esri, HERE, DeLorme',
    theme:   'light',
    casing:  'rgba(255,255,255,0.9)',
    maxZoom: 19,
  },
  {
    id:      'esri-satellite',
    label:   'Satellite',
    url:     'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    sub:     'abc',
    attr:    '&copy; Esri, DigitalGlobe',
    theme:   'dark',
    casing:  'rgba(0,0,0,0.6)',
    maxZoom: 19,
  },
]
