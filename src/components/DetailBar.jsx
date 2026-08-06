import { useState } from 'react'
import { formatDateRange, tripDays, tripCountriesLabel, kmFull } from '../data/trips'

export default function DetailBar({ trip, onClose }) {
  // The card fades and slides over 0.18s. Unmounting the content the instant
  // the trip is cleared would make it vanish rather than fade, so the last
  // trip stays rendered (hidden, and out of the a11y tree) until it's needed
  // again.
  const [shown, setShown] = useState(trip)
  if (trip && trip !== shown) setShown(trip) // adjust state while rendering

  return (
    <div className={`dbar${trip ? ' show' : ''}`} aria-hidden={trip ? undefined : 'true'}>
      {shown && (
        <>
          <div className="dbar-top">
            <div className="d-name">{shown.name}</div>
            <div className="dbar-tr">
              <div className="d-dates">{formatDateRange(shown.dateStart, shown.dateEnd)}</div>
              <button className="d-close" onClick={onClose} aria-label="Close trip details">✕</button>
            </div>
          </div>
          <div className="dbar-stats">
            <div className="dstat">
              <div className="dstat-v">{tripDays(shown)}</div>
              <div className="dstat-l">Days</div>
            </div>
            <div className="dstat">
              <div className="dstat-v">{kmFull(shown.kmTotal)}</div>
              <div className="dstat-l">Distance</div>
            </div>
            <div className="dstat">
              <div className="dstat-v dstat-truncate" title={tripCountriesLabel(shown)}>
                {tripCountriesLabel(shown)}
              </div>
              <div className="dstat-l">{new Set(shown.countries).size > 1 ? 'Countries' : 'Country'}</div>
            </div>
            {shown.photoCount > 0 && (
              <div className="dstat">
                <div className="dstat-v">{shown.photoCount.toLocaleString('en-GB')}</div>
                <div className="dstat-l">Photos</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
