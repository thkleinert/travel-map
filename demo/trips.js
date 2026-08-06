// ── Demo travel log ──────────────────────────────────────────────────────────
// A synthetic dataset: twelve well-known routes, generated with
// `npm run route` (Nominatim + OSRM) from the stop lists in demo/stops/.
// Nobody actually took these trips — it exists so the app can be demoed,
// screenshotted and developed against without publishing a real itinerary.
//
//   npm run demo        # dev server backed by this file and demo/routes/
//   npm run demo:km     # recompute the kmTotal values below
//
// Same shape as data/trips.js; see that file (and CLAUDE.md) for the
// meaning of each field.

export const HOME = { coords: [52.52, 13.40], label: 'Berlin' }

export const trips = [
  {
    id:          'iceland-ring-2025',
    name:        'Iceland Ring Road',
    countries:   ['Iceland'],
    dateStart:   '2025-06-07',
    dateEnd:     '2025-06-21',
    kmTotal:     1273,
    photoCount:  512,
    geojsonPath: '/iceland-ring-2025.geojson',
    destCoords:  [64.58, -18.14],
  },
  {
    id:          'norway-fjords-2024',
    name:        'Norwegian Fjords',
    countries:   ['Norway'],
    dateStart:   '2024-07-12',
    dateEnd:     '2024-07-26',
    kmTotal:     916,
    photoCount:  0,
    geojsonPath: '/norway-fjords-2024.geojson',
    destCoords:  [61.91, 7.85],
  },
  {
    id:          'alps-2024',
    name:        'Route des Grandes Alpes',
    countries:   ['Switzerland', 'France'],
    dateStart:   '2024-09-01',
    dateEnd:     '2024-09-12',
    kmTotal:     589,
    photoCount:  0,
    geojsonPath: '/alps-2024.geojson',
    destCoords:  [44.93, 6.71],
  },
  {
    id:          'japan-2023',
    name:        'Japan by Road',
    countries:   ['Japan'],
    dateStart:   '2023-04-02',
    dateEnd:     '2023-04-20',
    kmTotal:     852,
    photoCount:  428,
    geojsonPath: '/japan-2023.geojson',
    destCoords:  [35.03, 136.11],
  },
  {
    id:          'new-zealand-2023',
    name:        'South Island',
    countries:   ['New Zealand'],
    dateStart:   '2023-11-10',
    dateEnd:     '2023-12-03',
    kmTotal:     1331,
    photoCount:  0,
    geojsonPath: '/new-zealand-2023.geojson',
    destCoords:  [-44.06, 170.18],
  },
  {
    id:          'morocco-2022',
    name:        'Morocco',
    countries:   ['Morocco'],
    dateStart:   '2022-03-05',
    dateEnd:     '2022-03-22',
    kmTotal:     1321,
    photoCount:  0,
    geojsonPath: '/morocco-2022.geojson',
    destCoords:  [33.34, -6.00],
  },
  {
    id:          'vietnam-2022',
    name:        'Vietnam End to End',
    countries:   ['Vietnam'],
    dateStart:   '2022-10-08',
    dateEnd:     '2022-11-02',
    kmTotal:     1720,
    photoCount:  0,
    geojsonPath: '/vietnam-2022.geojson',
    destCoords:  [15.90, 107.48],
  },
  {
    id:          'patagonia-2021',
    name:        'Patagonia',
    countries:   ['Chile', 'Argentina'],
    dateStart:   '2021-01-09',
    dateEnd:     '2021-02-06',
    kmTotal:     1922,
    photoCount:  690,
    geojsonPath: '/patagonia-2021.geojson',
    destCoords:  [-46.43, -71.35],
  },
  {
    id:          'namibia-2020',
    name:        'Namibia',
    countries:   ['Namibia'],
    dateStart:   '2020-08-15',
    dateEnd:     '2020-09-02',
    kmTotal:     1494,
    photoCount:  0,
    geojsonPath: '/namibia-2020.geojson',
    destCoords:  [-24.35, 16.36],
  },
  {
    id:          'portugal-2019',
    name:        'Portuguese Coast',
    countries:   ['Portugal'],
    dateStart:   '2019-05-18',
    dateEnd:     '2019-05-30',
    kmTotal:     726,
    photoCount:  0,
    geojsonPath: '/portugal-2019.geojson',
    destCoords:  [39.08, -8.60],
  },
  {
    id:          'southwest-usa-2019',
    name:        'American Southwest',
    countries:   ['USA'],
    dateStart:   '2019-09-21',
    dateEnd:     '2019-10-09',
    kmTotal:     990,
    photoCount:  0,
    geojsonPath: '/southwest-usa-2019.geojson',
    destCoords:  [36.47, -113.27],
  },
  {
    id:          'mekong-2018',
    name:        'Mekong Overland',
    countries:   ['Thailand', 'Laos', 'Cambodia'],
    dateStart:   '2018-01-14',
    dateEnd:     '2018-02-24',
    kmTotal:     2032,
    photoCount:  0,
    geojsonPath: '/mekong-2018.geojson',
    destCoords:  [15.73, 102.06],
  },
]

// Places visited with no recorded route — see data/trips.js.
export const extraVisitedCountries = ['Scotland', 'Denmark', 'Singapore']

// ── Helpers ──────────────────────────────────────────────────────────────────
// Shared with the real dataset — tripHelpers.js holds no trip data, so nothing
// from data/trips.js is pulled in here.

import { colorLookup } from '../src/data/tripHelpers'

export {
  tripDays,
  tripYear,
  formatDateRange,
  tripCountries,
  tripCountriesLabel,
  PALETTE,
  kmCompact,
  kmFull,
} from '../src/data/tripHelpers'

export const tripColor = colorLookup(trips)
