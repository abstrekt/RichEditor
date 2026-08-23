import { useEffect, useRef, useState } from 'react'
import { canRedo, canUndo, linkAt, markState } from '../model'
import type { Action, EditorState, Mark, MarkType } from '../model'

/**
 * The formatting bar.
 *
 * Buttons show three states, not two, because a selection can be partly
 * formatted. Which state a button is in also predicts what pressing it does:
 * lit means pressing removes, anything less than lit means pressing adds. That
 * is the same rule the toggle operation follows, computed by the same function,
 * so the indicator and the action cannot disagree.
 */

interface ToolbarProps {
  readonly state: EditorState
  readonly dispatch: (action: Action) => void
  /** Returns focus to the editable after an interaction that took it away. */
  readonly refocus: () => void
}

export function Toolbar({ state, dispatch, refocus }: ToolbarProps) {
  const marks = markState(state)
  const link = linkAt(state)
  const [linkOpen, setLinkOpen] = useState(false)

  const hasSelection = state.selection !== null

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <MarkButton type="bold" label="Bold" shortcut="B" {...{ marks, dispatch, state, hasSelection }} />
      <MarkButton type="italic" label="Italic" shortcut="I" {...{ marks, dispatch, state, hasSelection }} />

      <span className="toolbar-divider" aria-hidden="true" />

      <button
        type="button"
        className="toolbar-button"
        aria-pressed={link !== null}
        disabled={!hasSelection}
        title={link ? 'Edit link' : 'Add link'}
        /* Pressing a mouse button inside the toolbar would blur the editable
           and collapse the selection before the click ever lands, so the range
           the user meant to format would be gone by the time we acted on it.
           Cancelling mousedown keeps focus and selection where they are. */
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setLinkOpen((open) => !open)}
      >
        Link
      </button>

      <span className="toolbar-divider" aria-hidden="true" />

      <button
        type="button"
        className="toolbar-button"
        disabled={!canUndo(state.history)}
        title="Undo"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ type: 'undo' })}
      >
        Undo
      </button>
      <button
        type="button"
        className="toolbar-button"
        disabled={!canRedo(state.history)}
        title="Redo"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ type: 'redo' })}
      >
        Redo
      </button>

      {linkOpen && (
        <LinkPopover
          initialHref={link?.href ?? ''}
          canRemove={link !== null}
          onCancel={() => {
            setLinkOpen(false)
            refocus()
          }}
          onSubmit={(href) => {
            const at = link?.range ?? state.selection
            if (at) {
              dispatch({ type: 'toggleMark', at, mark: { type: 'link', href }, timestamp: Date.now() })
            }
            setLinkOpen(false)
            refocus()
          }}
          onRemove={() => {
            const at = link?.range
            if (at) {
              dispatch({ type: 'removeMark', at, markType: 'link', timestamp: Date.now() })
            }
            setLinkOpen(false)
            refocus()
          }}
        />
      )}
    </div>
  )
}

/* Bold and italic can be built from a type alone. Link cannot — it carries a
   target — which is why it is a separate control rather than a third
   MarkButton, and why this type excludes it instead of casting the difference
   away. */
type ToggleableMark = Extract<Mark, { type: 'bold' } | { type: 'italic' }>

interface MarkButtonProps {
  readonly type: ToggleableMark['type']
  readonly label: string
  readonly shortcut: string
  readonly marks: { readonly active: readonly MarkType[]; readonly mixed: readonly MarkType[] }
  readonly state: EditorState
  readonly dispatch: (action: Action) => void
  readonly hasSelection: boolean
}

function MarkButton({
  type,
  label,
  shortcut,
  marks,
  state,
  dispatch,
  hasSelection,
}: MarkButtonProps) {
  const active = marks.active.includes(type)
  const mixed = marks.mixed.includes(type)

  return (
    <button
      type="button"
      className={`toolbar-button${mixed ? ' is-mixed' : ''}`}
      /* "mixed" is a real value for aria-pressed, so the third state is
         announced rather than being a purely visual distinction. */
      aria-pressed={mixed ? 'mixed' : active}
      disabled={!hasSelection}
      title={`${label} (Ctrl+${shortcut})`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!state.selection) return
        const mark: ToggleableMark = { type }
        dispatch({ type: 'toggleMark', at: state.selection, mark, timestamp: Date.now() })
      }}
    >
      {label}
    </button>
  )
}

interface LinkPopoverProps {
  readonly initialHref: string
  readonly canRemove: boolean
  readonly onSubmit: (href: string) => void
  readonly onRemove: () => void
  readonly onCancel: () => void
}

/**
 * Part of the toolbar rather than floating over the document.
 *
 * Anchoring to the selected text reads better, but needs the range's bounding
 * rectangle, placement maths and viewport-edge handling — real interface work
 * in an exercise about architecture. Floating it below the toolbar instead was
 * worse than either: it covered the first line of the document, hiding the very
 * text being linked. Occupying a row of its own avoids the overlay entirely.
 */
function LinkPopover({ initialHref, canRemove, onSubmit, onRemove, onCancel }: LinkPopoverProps) {
  const [href, setHref] = useState(initialHref)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  /* This input genuinely needs focus, so unlike the buttons it cannot cancel
     mousedown. Taking focus blurs the editable — but the selection lives in the
     model, and a browser selection outside the container is ignored rather than
     read in, so the range survives being blurred. */
  return (
    <form
      className="link-popover"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = href.trim()
        if (trimmed) onSubmit(trimmed)
      }}
    >
      <input
        ref={inputRef}
        type="url"
        className="link-input"
        value={href}
        placeholder="https://example.com"
        aria-label="Link address"
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <button type="submit" className="toolbar-button">
        Apply
      </button>
      {canRemove && (
        <button
          type="button"
          className="toolbar-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
        >
          Remove
        </button>
      )}
    </form>
  )
}
