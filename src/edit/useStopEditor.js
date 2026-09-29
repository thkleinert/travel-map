import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { editStatus, normalizeStops, saveStops } from './editApi'

// Edit-mode state. Changes are drafted locally — every rename/move/add/delete
// pushes an undo step — and a single Save commits all touched trips at once,
// so a batch of fixes is one commit and one redeploy rather than one per click.
//
//   draft     { [tripId]: stops }  unsaved edits
//   saved     { [tripId]: stops }  what the last save wrote; the route files
//                                  the page loaded are stale until the redeploy
//   baseCount { [tripId]: n }      Points in the file when the draft started —
//                                  applyStops checks it before writing
const EMPTY = { draft: {}, saved: {}, history: [], baseCount: {} }

function reducer(state, action) {
  switch (action.type) {
    case 'change': {
      const { tripId, current, next } = action
      return {
        ...state,
        draft: { ...state.draft, [tripId]: next },
        history: [...state.history, { tripId, before: state.draft[tripId] }],
        baseCount: tripId in state.baseCount ? state.baseCount : { ...state.baseCount, [tripId]: current.length },
      }
    }
    case 'undo': {
      if (!state.history.length) return state
      const { tripId, before } = state.history[state.history.length - 1]
      const draft = { ...state.draft }
      const baseCount = { ...state.baseCount }
      if (before === undefined) { delete draft[tripId]; delete baseCount[tripId] }
      else draft[tripId] = before
      return { ...state, draft, baseCount, history: state.history.slice(0, -1) }
    }
    case 'discard':
      return { ...EMPTY, saved: state.saved }
    case 'saved':
      return { ...EMPTY, saved: { ...state.saved, ...action.saved } }
    default:
      return state
  }
}

export function useStopEditor(trips) {
  const [available, setAvailable] = useState(false)
  const [editing, setEditing] = useState(false)
  const [state, dispatch] = useReducer(reducer, EMPTY)
  const [status, setStatus] = useState(null) // { kind: 'saving'|'saved'|'error', text }
  const head = useRef(null)

  useEffect(() => {
    let live = true
    editStatus().then(s => {
      if (!live || !s) return
      head.current = s.head
      setAvailable(true)
    })
    return () => { live = false }
  }, [])

  const { draft, saved, history, baseCount } = state
  const dirty = Object.keys(draft).length > 0

  // current: the stops as displayed right now (so the first edit of a trip
  // captures its baseline); next: the stops after this edit
  const change = useCallback((tripId, current, next) => {
    dispatch({ type: 'change', tripId, current, next })
    setStatus(null)
  }, [])
  const undo    = useCallback(() => { dispatch({ type: 'undo' }); setStatus(null) }, [])
  const discard = useCallback(() => { dispatch({ type: 'discard' }); setStatus(null) }, [])

  const save = useCallback(async () => {
    const ids = Object.keys(draft)
    if (!ids.length) return
    const byId = Object.fromEntries(trips.map(t => [t.id, t]))
    setStatus({ kind: 'saving', text: 'Saving…' })
    try {
      const names = ids.map(id => byId[id].name)
      head.current = await saveStops({
        head: head.current,
        message: `Edit stops: ${[...new Set(names)].join(', ')}`,
        changes: ids.map(id => ({
          file: byId[id].geojsonPath.replace(/^\//, ''),
          stops: draft[id],
          loadedCount: baseCount[id],
        })),
      })
      dispatch({ type: 'saved', saved: Object.fromEntries(ids.map(id => [id, normalizeStops(draft[id])])) })
      setStatus({ kind: 'saved', text: head.current === 'dev' ? 'Saved to the local route files' : 'Saved — live after the redeploy (~2 min)' })
    } catch (err) {
      setStatus({ kind: 'error', text: `Save failed: ${err.message}` })
    }
  }, [draft, baseCount, trips])

  // ⌘Z / Ctrl+Z while editing, except inside text fields (their own undo)
  useEffect(() => {
    if (!editing) return
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      if (e.target instanceof HTMLInputElement) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, undo])

  useEffect(() => {
    if (!dirty) return
    const onUnload = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  return {
    available, editing, setEditing,
    overrides: { ...saved, ...draft },
    change, undo, discard, save,
    canUndo: history.length > 0,
    changeCount: history.length,
    dirty, status,
  }
}
