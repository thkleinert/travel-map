# Travels — Personal Travel Log

Minimalist travel journal with a full-screen interactive Leaflet map.
Space Grotesk throughout, per-trip route colors, four switchable tile styles
(Dark / Light / Street / Satellite), floating overlay panels.

## Quick start

```sh
npm install
npm run dev
# → http://localhost:5174 (PORT env var overrides)
```

## Project layout

```
src/
  App.jsx              — full-screen shell: topbar, map, panels, selection state
  App.css              — all design tokens as CSS custom properties + mobile layout
  components/
    Sidebar.jsx        — floating journeys panel: stats header, year-grouped list
    MapView.jsx        — Leaflet map, GeoJSON routes + stop markers, fitBounds
    smoothWheelZoom.js — continuous wheel/trackpad zoom handler (see Map behavior)
    DetailBar.jsx      — floating trip detail card (bottom center)
    EditBar.jsx        — edit-mode toolbar (see Edit mode below)
  edit/
    editApi.js         — edit-mode client: /api/edit calls, applyStops()
    useStopEditor.js   — draft / undo history / save state
  data/
    tripHelpers.js     — dates/countries/palette/distance helpers, no data, so
                         both datasets can share them
    mapStyles.js       — selectable tile styles (url, theme, casing, zoom caps)
    worldCountries.js  — visited-countries overlay data (world-atlas + topojson)
    ukCountries.topo.json — England/Scotland/Wales/NI boundaries (see below)
data/                  — the real dataset (used whenever data/trips.js exists)
  trips.js             — trip metadata array + HOME marker (data only)
  routes/*.geojson     — one route file per trip (LineStrings = tracks, Points = stops)
scripts/
  make-route.js        — stops list → routed GeoJSON (Nominatim + OSRM)
  import-trip.js       — import a completed trip from the travel-planner app
  compute-km.js        — recompute kmTotal values from the GeoJSON tracks
  simplify-geojson.js  — build-time route thinning (used by vite.config.js)
  build-uk-countries.js — regenerates ukCountries.topo.json (rarely needed)
demo/                  — synthetic dataset for screenshots and development
  trips.js             — same shape as data/trips.js (12 invented trips)
  routes/*.geojson     — generated with make-route, then pre-simplified
  stops/*.json         — the stop lists they were generated from
functions/api/edit/    — Pages Function: edit mode's GitHub relay (deployed only)
public/                — Vite publicDir: served from the site root verbatim
  favicon.svg,
  apple-touch-icon.png — site icons
  _headers             — Cloudflare Pages cache headers
```

## Stack

React 18 + Vite 5 + react-leaflet 4. Tiles: Esri ArcGIS Online (no key).
World country boundaries via `world-atlas` + `topojson-client` (bundled,
code-split — see Map behavior below). Deployed to Cloudflare Pages —
auto-deploys on push to `main`.

`vite.config.js` resolves the active dataset — `demo/` when `DEMO=1` or when
`data/trips.js` doesn't exist (so a fresh clone of the template runs out of the
box), `data/` otherwise. It aliases the components' `data/trips` import to the
dataset's `trips.js` and runs a `dataset-routes` plugin that serves the
dataset's `routes/*.geojson` at `/<filename>.geojson` in dev and copies them
into `dist/` on build. `publicDir` is `public/` (icons, `_headers`).

It also runs a `simplify-route-geojson` build plugin: the tracks come off OSRM at
full road precision (72 MB, ~967k coordinate pairs), which is pointless for a map
that opens at zoom 2. The plugin thins the copies in `dist/` with
Douglas–Peucker at ~11 m and 5-decimal rounding — 72 MB → 4.9 MB, no visible
difference — and leaves `data/routes/` untouched, so `npm run km` keeps
measuring the real geometry. `npm run dev` serves the full files.

`npm run lint` runs ESLint (flat config, `react-hooks` included). Keep it clean:
the hooks rules are what catch stale-dependency bugs in the map's view logic.

## Demo dataset

`npm run demo` (i.e. `DEMO=1 vite`) points the app at `demo/trips.js` and
`demo/routes/` instead of the real ones — same dataset mechanism as above,
demo/ forced. Every screenshot in README.md comes from it, so
the repo's public face contains no real itinerary. Nothing under `demo/` is
reachable from a normal `npm run dev`/`build`.

The routes were generated the documented way and committed pre-simplified
(4.6 MB → 682 kB), so the whole dataset is under 800 kB:

```sh
for f in demo/stops/*.json; do
  ROUTES_DIR=demo/routes CONTACT=you@example.com \
    node scripts/make-route.js "$f" "$(basename "$f" .json)" --force
done
npm run demo:km          # = compute-km.js --trips demo/trips.js --routes demo/routes
```

Both `make-route.js` (via the `ROUTES_DIR` env var) and `compute-km.js` (via
`--trips` / `--routes`) can be pointed at either dataset. `demo/trips.js` keeps
its own `HOME` (Berlin) and sets a few non-zero `photoCount`s so the Photos stat
appears in screenshots.

## Data model

There is no database — trip metadata lives in `data/trips.js`, route
geometry in `data/routes/*.geojson` (LineStrings = tracks, Points = stops).

## Adding trips

0a. Coming from the travel-planner app? Import a completed trip by its share
   token — the planner already has the visited places (in visit order) and the
   routed track, so this skips geocoding/OSRM entirely:
   ```sh
   npm run import -- <share-token> trip-slug   # → data/routes/trip-slug.geojson
   ```
   Fetches the planner's `trip-geojson` export (routed LineStrings + named Point
   stops), writes the file, reverse-geocodes the stops to fill in `countries`,
   and prints a ready-to-paste `trips.js` entry. Override the endpoint with the
   `TRIP_EXPORT_URL` env var. Then continue from step 2.

0b. No GeoJSON yet, and not from the planner? Generate one from a stops list:
   ```sh
   npm run route -- stops.json trip-slug   # → data/routes/trip-slug.geojson
   ```
   `stops.json` is an array of stops in travel order; each entry is a place
   name (geocoded via Nominatim), `[lat, lng]`, or an object — set
   `"fly": true` on a stop to arrive there by air (no road leg, gap counts
   as flight distance), or `"via": true` to route through a place without
   drawing a stop marker (pass-through waypoints, repeated stops):
   ```json
   ["Reykjavik", { "name": "Höfn, Iceland" }, { "name": "Akureyri", "fly": true }]
   ```
   Road legs are routed via the public OSRM server; legs it can't route
   (ferries, oceans) are left as gaps automatically. The script prints a
   ready-to-paste trips.js entry with computed `destCoords`.

1. Drop the `.geojson` file into `data/routes/` — filename must match the
   `geojsonPath` in `trips.js` (without the leading `/`).

2. Add an entry to `data/trips.js` (array is sorted newest → oldest):
   ```js
   {
     id:          'trip-slug',        // unique, matches filename
     name:        'Display Name',
     countries:   ['Country'],        // every country visited, in travel order —
                                       // single-country trips just use one element;
                                       // compact UI truncates long lists with an ellipsis
     dateStart:   '2024-06-01',       // ISO 8601
     dateEnd:     '2024-06-14',
     kmTotal:     1234,               // run `npm run km` to compute from track
     photoCount:  0,                  // 0 hides the photos stat
     geojsonPath: '/trip-slug.geojson',
     destCoords:  [lat, lng],         // fallback marker/fly-to if geojson missing
     color:       '#FB923C',          // optional — omit to auto-assign from palette
   }
   ```

3. Run `npm run km` — computes `kmTotal` from the GeoJSON track: haversine over
   all line segments, **plus the hops needed to join them** (flights/ferries).
   Segment order in a file is not travel order for the older routes, so the
   script first reconstructs a plausible order — greedily chaining segments end
   to end and keeping the cheapest chain — instead of bridging in file order,
   which used to invent thousands of phantom kilometres. The report prints how
   much of each total is unrouted hops. `npm run km:check` shows the diff
   without writing.

4. Aggregate stats (trips / countries / days / km) recompute automatically.

Colors are auto-assigned by array position from the 12-color `PALETTE`, so
adding a trip at the top shifts the others — pin `color:` to prevent that.

## Map behavior

- **Styles** (`src/data/mapStyles.js`): each has a tile URL, a `theme`
  (drives the `:root.light` UI palette), and optional `casing` — a halo drawn
  under routes on busy tiles (Street/Satellite).
- **Zoom**: Leaflet's stepped `scrollWheelZoom` is off; `smoothWheelZoom.js`
  replaces it with a per-frame eased zoom around the cursor (trackpads stream
  tiny deltas, which the stock 40 ms batch-snap-animate cycle turned into
  stutter; pinch arrives as ctrl+wheel and gets its own gain). +/− buttons sit
  bottom right above the attribution, hidden on mobile (pinch + detail card).
- **Selection**: click a row or stop marker → `fitBounds` on the trip's track;
  other trips dim to near-invisible. Deselect via map click, Escape, ✕, or
  re-click. The journeys panel slides away while a trip is selected (any
  screen size) and returns on deselect — unless it was hidden via the list
  toggle, which sets a sticky preference that selection never overrides.
- **Stops**: Point features render as colored dots, sized by zoom level.
  Hovering shows a tooltip with the Point's `name` property (falls back to
  the trip name for old GeoJSONs without names).
- **Visited-countries overlay**: a subtle tint over every country in any
  trip's `countries` list, plus `extraVisitedCountries` in trips.js (places
  visited with no recorded trip — no dates/route/km). These count toward
  the sidebar's "Countries" stat (under "All years" only, since they have no
  date) and appear as a non-clickable "Also visited" row at the bottom of
  the journeys list, but don't affect Trips/Days/Km. Overlay is off by
  default; toggled via the standalone icon button next to the map-style menu.
  - Country boundaries come from `world-atlas`'s 50m resolution (needed for
    small territories like Singapore/Hong Kong) via `topojson-client`, loaded
    as an async chunk (~380 kB gzipped) the first time the overlay is switched
    on, so it costs nothing for anyone who never uses it.
  - Name mismatches between trips.js and Natural Earth (`USA` → `United
    States of America`, `Czech Republic` → `Czechia`, `Türkiye` → `Turkey`,
    `Dominican Republic` → `Dominican Rep.`) are aliased in
    `worldCountries.js` — add new ones there if a country silently fails to
    highlight.
  - England / Scotland / Wales / Northern Ireland aren't distinguished in
    world-atlas (just "United Kingdom" as a whole) — `ukCountries.topo.json`
    supplies them separately, dissolved from martinjc/UK-GeoJSON's district
    boundaries and simplified (regenerate via `npm install --no-save
    topojson-server topojson-simplify && node scripts/build-uk-countries.js`
    if it ever needs rebuilding; those two packages aren't runtime deps).
  - A few countries (France, so far) bundle a distant overseas territory
    into the same admin-0 polygon as the mainland — visiting "France"
    shouldn't imply French Guiana. `OVERSEAS_EXCLUSIONS` in
    `worldCountries.js` drops sub-polygons beyond a distance threshold by
    default; there's no opt-back-in for a specific overseas territory yet.
  - Russia's polygon crosses the antimeridian without being split there;
    `worldCountries.js` unwraps the longitude rather than splitting the ring
    (splitting left an open path that Leaflet auto-closed with a spurious
    line). Any ring that still doesn't close within tolerance after that
    (seen once, in the simplified UK data) is dropped rather than rendered
    broken.
- **Home marker**: ring at `HOME` in the active dataset's `trips.js` —
  `{ coords: [lat, lng], label }`; the label feeds the marker tooltip.
- **Paint order** is pinned with explicit Leaflet panes rather than layer
  creation order: `visited-countries` (z 398) below `route-casing` (z 399)
  below the default overlay pane (400) that holds the routes. Sharing one pane
  meant a casing re-created after a style switch drew *over* its own route.
- **Attribution**: required by Esri/OSM — do not hide the Leaflet
  attribution control. It lives inside the map's stacking context, so the
  floating panels would cover it; `App.jsx` publishes the mobile sheet's height
  as `--ui-bottom` and the CSS lifts the control clear of it.
- **Mobile** (≤720px): journeys panel becomes a bottom sheet toggled from the
  topbar (z-index 12, above the detail card); detail bar goes full-width.
  Controls get ≥44px hit areas under `@media (pointer: coarse)`, and
  `prefers-reduced-motion` turns off both the CSS transitions and the map's
  fly-to glides.

## Edit mode

Pencil button (top right) → select a trip → drag stops to move, click one for
a rename/delete popup, click the map to add one (name prefilled by a Nominatim
reverse geocode). Edits are drafted in `useStopEditor` with one undo step each
(Undo button, ⌘Z); Save writes every touched trip in a single commit.

The button only appears when `GET /api/edit` answers `{ enabled: true }`:

- **`npm run dev`**: `devEditApi` in `vite.config.js` serves `/api/edit` from
  the active dataset's `routes/` dir — Save writes the files directly.
- **Deployed**: `functions/api/edit/[[path]].js` relays to the GitHub API and
  is 404 unless `GITHUB_TOKEN`, `GITHUB_REPO`, `ACCESS_TEAM_DOMAIN` and
  `ACCESS_AUD` are set (README step 8). It verifies the Cloudflare Access JWT
  itself on every request. It never parses route files — they run to 12 MB and
  a Function's CPU budget is milliseconds — so the browser fetches the
  full-precision source (`/api/edit/file/<name>?ref=<head>`), rewrites it
  (`applyStops`), and uploads it base64 as a blob; the Function wraps that in
  the blob API's JSON without decoding it, then makes tree → commit →
  non-forced ref update (409 if the branch moved).

`applyStops` identifies stops by index among the file's Point features (the
build's simplify step keeps feature order) and checks each against the source
coordinates before writing. Undragged stops keep their full-precision
coordinates — the map only has the simplified copy's 5-decimal ones. It keeps
the file's own layout (2-space pretty vs compact) so diffs stay small.

Clicks inside the stop popup defer their DOM changes with `setTimeout`:
Leaflet decides "popup click vs map click" by walking up from the target, and
a popup already removed from the DOM made Delete also add a stop.

**Route file caching**: `datasetRoutes` exposes `virtual:route-versions`
(content hash per file, build only) and the app fetches
`/<trip>.geojson?v=<hash>`, so `_headers` caches `*.geojson` as immutable.
Before this, renamed stops kept showing old names for up to a week.

## Deploy

Push to `main` — Cloudflare Pages builds and deploys automatically.

`public/_headers` (copied to `dist/_headers` via `publicDir`) sets both `/` and
`/index.html` to `no-cache`, so a tab left open across a deploy always
revalidates the HTML. Both paths are listed because Pages matches the *request*
path and the app is loaded as `/` — the `/index.html` rule on its own never
fired. Without it a stale `index.html` keeps requesting an old build's
content-hashed chunk filenames (e.g. the async `worldCountries` chunk), which
404 silently once enough deploys have passed. Hashed files under `/assets/*`
stay aggressively cached since their filename changes whenever their content
does; `*.geojson` is immutable too, because the app requests it as
`?v=<content hash>` (see Edit mode → Route file caching).

Manual fallback:

```sh
npm run build
npx wrangler pages deploy dist --project-name travels
```
