// Tile styles selectable from the topbar.
// `theme` drives the UI panel palette (:root.light class).
// `casing` draws a halo polyline under routes on busy or pale imagery, so the
//   route colors (picked for dark tiles) keep their contrast; null = none.
// `maxZoom` is the deepest zoom the map will go while this style is picked.
// `maxNativeZoom` is the deepest zoom the provider actually serves, when that
//   is shallower than `maxZoom` — Leaflet then upscales the last real tile
//   instead of requesting one the provider answers with a placeholder.
// `sub` must always be set, even for URLs without a `{s}` placeholder: Leaflet
//   reads `subdomains.length` unconditionally, so passing undefined throws
//   inside getTileUrl and takes the whole map down.
//
// All four styles are Esri ArcGIS Online services and need no API key. Dark
// and Light used to come from CARTO, whose basemaps were keyless too until
// they began answering every tile on basemaps.cartocdn.com with an
// "API KEY REQUIRED" watermark image — don't go back without a key.

const ESRI_CANVAS_ATTR = '&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const MAP_STYLES = [
  {
    id:      'esri-dark',
    label:   'Dark',
    url:     'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    sub:     'abc',
    attr:    ESRI_CANVAS_ATTR,
    theme:   'dark',
    casing:  null,
    maxZoom: 20,
    // the Canvas basemaps stop at 16 and answer deeper tiles with a grey
    // "Map data not yet available" square
    maxNativeZoom: 16,
  },
  {
    id:      'esri-light',
    label:   'Light',
    url:     'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    sub:     'abc',
    attr:    ESRI_CANVAS_ATTR,
    theme:   'light',
    // the palette is tuned for dark tiles; without a casing the dimmed routes
    // all but disappear against the near-white basemap
    casing:  'rgba(0,0,0,0.30)',
    maxZoom: 20,
    maxNativeZoom: 16,
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
