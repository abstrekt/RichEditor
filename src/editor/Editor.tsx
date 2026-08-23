import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_HISTORY, apply, paragraph, selectionsEqual, toJSON } from '../model'
import type { Action, EditorState, Selection } from '../model'
import { toAction, toHistoryAction } from './inputHandler'
import { Toolbar } from './Toolbar'
import { load, save } from './storage'
import { readSelection, writeSelection } from './domSelection'
import { renderDoc } from './render'

const INITIAL_BLOCK_ID = 'b1'

function initialState(): EditorState {
  /* A stored document reconstructs through the same validating deserializer as
     any external one, so a corrupt or outdated value starts fresh instead of
     preventing the editor from booting. */
  const restored = load()

  return {
    doc: restored ?? { blocks: [paragraph(INITIAL_BLOCK_ID, 'Type here.')] },
    selection: null,
    pendingMarks: null,
    /* History deliberately does not survive a reload. Undoing into a session
       the user cannot remember would be worse than starting clean. */
    history: EMPTY_HISTORY,
  }
}

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<EditorState>(initialState)

  /*
   * Writing the selection fires selectionchange, which reads it straight back —
   * so the loop has to be broken somewhere.
   *
   * Guarding on a flag cleared after the write does not work: selectionchange
   * is dispatched as a task and microtasks drain first, so the flag is already
   * clear by the time the echo arrives. It only looks like it works because
   * writing an unchanged selection fires no event at all.
   *
   * So the guard is by value instead. The last selection written is recorded,
   * and an incoming event matching it is our own echo. A ref rather than state
   * because it must be readable synchronously inside a listener and must not
   * itself cause a render.
   */
  const lastWritten = useRef<Selection | null>(null)

  /*
   * useLayoutEffect, not useEffect: this runs after the DOM is updated but
   * before the browser paints, so the caret is repositioned in the same frame.
   * Under useEffect the user would see it sit in the wrong place for a frame.
   */
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    renderDoc(container, state.doc)

    if (state.selection) {
      lastWritten.current = state.selection
      writeSelection(container, state.selection)
    }
  }, [state])

  const handleBeforeInput = useCallback((event: InputEvent) => {
    /* Cancel first, unconditionally. Deciding whether we handle this input
       comes second — the browser must not write here regardless of the answer. */
    event.preventDefault()

    setState((current) => {
      const action = toAction(
        {
          inputType: event.inputType,
          data: event.data,
          /* Read here rather than passed along: DataTransfer is a DOM type,
             and the mapping below is meant to hold none. */
          clipboardText: event.dataTransfer?.getData('text/plain') ?? null,
        },
        { state: current, timestamp: Date.now(), newId: () => crypto.randomUUID() },
      )
      return action ? apply(current, action) : current
    })
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) setFollowing(true)

    const action = toHistoryAction(event)
    if (!action) return

    /* Cancelled so the browser does not also try to run its own undo, which
       would rewrite the DOM behind the model's back. */
    event.preventDefault()
    setState((current) => apply(current, action))
  }, [])

  /*
   * Whether a modifier is currently held, so links can look clickable exactly
   * while the gesture that opens them is available. Without it a link looks
   * identical whether or not the modifier is down, and the only way to find out
   * is to try.
   */
  const setFollowing = useCallback((following: boolean) => {
    containerRef.current?.classList.toggle('is-following', following)
  }, [])

  const handleClick = useCallback((event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const anchor = target.closest('a')
    if (!anchor) return

    /*
     * This is an editing surface, not a reading one, so a plain click places
     * the caret rather than navigating — otherwise typing in a link-heavy
     * document is a minefield.
     *
     * That takes the obvious gesture away, which is why every editor gives it
     * back on a modifier. Without this, a link is simply unreachable: plain
     * click edits, and nothing opens it.
     */
    if (event.metaKey || event.ctrlKey) {
      const href = anchor.getAttribute('href')
      if (href) {
        event.preventDefault()
        /* noopener so the opened page cannot reach back through window.opener
           and navigate the editor out from under unsaved work. */
        window.open(href, '_blank', 'noopener,noreferrer')
      }
      return
    }

    event.preventDefault()
  }, [setFollowing])

  const handleSelectionChange = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    setState((current) => {
      const selection = readSelection(container, current.doc)
      if (!selection) return current

      /* Two reasons to return the state unchanged, and both matter. It is our
         own echo if it matches what we just wrote. And returning a new object
         for an unchanged selection would re-render, re-write the selection,
         and hand the loop another turn — so bailing out here is what actually
         terminates it. */
      if (selectionsEqual(selection, lastWritten.current)) return current
      if (selectionsEqual(selection, current.selection)) return current

      /* A caret the user moved themselves discards any pending formatting. */
      return { ...current, selection, pendingMarks: null }
    })
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    /* Attached directly rather than through React's synthetic events: React's
       onBeforeInput has historically mapped to a different underlying event,
       and this needs the real one with its inputType intact. */
    /* On the document rather than the container: releasing the modifier while
       the pointer sits over a link would otherwise leave it looking clickable
       when it no longer is, and a blur can swallow the keyup entirely. */
    const clearFollowing = () => setFollowing(false)

    container.addEventListener('beforeinput', handleBeforeInput)
    container.addEventListener('keydown', handleKeyDown)
    container.addEventListener('click', handleClick)
    container.ownerDocument.addEventListener('keyup', clearFollowing)
    window.addEventListener('blur', clearFollowing)
    container.ownerDocument.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      container.removeEventListener('beforeinput', handleBeforeInput)
      container.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('click', handleClick)
      container.ownerDocument.removeEventListener('keyup', clearFollowing)
      window.removeEventListener('blur', clearFollowing)
      container.ownerDocument.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [handleBeforeInput, handleClick, handleKeyDown, handleSelectionChange, setFollowing])

  /* Written on every document change. The model is small and localStorage is
     synchronous, so debouncing would add a way to lose the last keystroke in
     exchange for saving work that costs nothing. */
  useEffect(() => {
    save(state.doc)
  }, [state.doc])

  const serialized = useMemo(() => toJSON(state.doc, 2), [state.doc])

  const dispatch = useCallback((action: Action) => {
    setState((current) => apply(current, action))
  }, [])

  const refocus = useCallback(() => {
    containerRef.current?.focus()
  }, [])

  return (
    <div className="editor">
      <Toolbar state={state} dispatch={dispatch} refocus={refocus} />
      <div
        ref={containerRef}
        className="editor-surface"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        aria-label="Document"
      />

      {/* The serialized form, live. The requirement is that the model
          round-trips through JSON; showing what it writes — and reloading the
          page to read it back — demonstrates that rather than asserting it. */}
      <details className="serialized">
        <summary>Serialized document</summary>
        <pre className="serialized-json">{serialized}</pre>
        <p className="serialized-note">
          Saved to local storage on every change and reconstructed on load, so a
          refresh performs the round trip.
        </p>
      </details>
    </div>
  )
}
