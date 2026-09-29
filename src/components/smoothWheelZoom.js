import L from 'leaflet'

// Continuous wheel / trackpad zoom. Leaflet's built-in handler batches wheel
// events for 40 ms, snaps the result to zoomSnap and animates to it — fine for
// a notched mouse wheel, but a trackpad streams dozens of tiny deltas, so each
// batch restarts the animation and the zoom stutters in visible steps. This
// handler instead eases the zoom toward a running target every frame, keeping
// the point under the cursor fixed, and moves the map without snapping.
// It drives the map through `_move` / `_moveStart` / `_moveEnd` — the same
// private hooks Leaflet's own flyTo uses — so layers, tiles and zoomend
// listeners behave exactly as they do for any other zoom.

// zoom levels per pixel of wheel delta; pinch (ctrlKey) sends much smaller
// deltas than a two-finger scroll, so it needs a higher gain to feel alike
const SCROLL_GAIN = 1 / 300
const PINCH_GAIN  = 1 / 60
const EASE        = 0.3     // fraction of the remaining distance per frame
const LINE_PX     = 16      // deltaMode 1 (lines) → pixels, Firefox + mice

export const SmoothWheelZoom = L.Handler.extend({
  addHooks() {
    this._onWheel = this._onWheel.bind(this)
    this._step    = this._step.bind(this)
    // native listener: must be non-passive to stop the page (or the
    // browser's own pinch-zoom) from reacting to the same event
    this._map.getContainer().addEventListener('wheel', this._onWheel, { passive: false })
  },

  removeHooks() {
    this._map.getContainer().removeEventListener('wheel', this._onWheel)
    if (this._frame) cancelAnimationFrame(this._frame)
    if (this._active) this._finish()
  },

  _onWheel(e) {
    e.preventDefault()
    const map = this._map

    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= LINE_PX
    else if (e.deltaMode === 2) dy *= map.getSize().y

    if (!this._active) {
      map._stop()               // cancel any running flyTo / pan animation
      this._active = true
      this._target = map.getZoom()
      map._moveStart(true, false)
      this._frame = requestAnimationFrame(this._step)
    }

    const gain = e.ctrlKey ? PINCH_GAIN : SCROLL_GAIN
    this._target = Math.min(map.getMaxZoom(),
      Math.max(map.getMinZoom(), this._target - dy * gain))
    this._anchor = map.mouseEventToContainerPoint(e)
  },

  _step() {
    const map  = this._map
    const zoom = map.getZoom()
    const diff = this._target - zoom
    const next = Math.abs(diff) < 0.002 ? this._target : zoom + diff * EASE

    // Same arithmetic as map.setZoomAround: shift the centre so the anchor
    // pixel shows the same lat/lng before and after the scale change.
    const half   = map.getSize().divideBy(2)
    const scale  = map.getZoomScale(next, zoom)
    const offset = this._anchor.subtract(half).multiplyBy(1 - 1 / scale)
    map._move(map.containerPointToLatLng(half.add(offset)), next)

    if (next === this._target) this._finish()
    else this._frame = requestAnimationFrame(this._step)
  },

  _finish() {
    this._active = false
    this._frame  = null
    this._map._moveEnd(true)    // fires zoomend / moveend
  },
})
