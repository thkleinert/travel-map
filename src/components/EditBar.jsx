// Floating edit-mode toolbar (top centre): what to do, unsaved-change count,
// Undo / Save / Done, and the result of the last save.
export default function EditBar({ editor, activeTrip, onDone }) {
  const { changeCount, canUndo, dirty, status, undo, save } = editor
  const saving = status?.kind === 'saving'

  const hint = activeTrip
    ? 'Drag a stop to move it · click it to rename or delete · click the map to add one'
    : 'Select a trip to edit its stops'

  return (
    <div className="editbar" role="toolbar" aria-label="Edit stops">
      <div className="editbar-text">
        <span className="editbar-title">Editing{activeTrip ? ` · ${activeTrip.name}` : ''}</span>
        <span className={`editbar-hint${status ? ` ${status.kind}` : ''}`} aria-live="polite">
          {status?.text ?? (dirty ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}` : hint)}
        </span>
      </div>
      <div className="editbar-actions">
        <button onClick={undo} disabled={!canUndo || saving} title="Undo (⌘Z)">Undo</button>
        <button className="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} disabled={saving}>Done</button>
      </div>
    </div>
  )
}
