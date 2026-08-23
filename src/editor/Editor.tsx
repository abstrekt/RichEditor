import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EMPTY_HISTORY, apply, paragraph, selectionsEqual } from '../model'
import type { EditorState, Selection } from '../model'
import { toAction, toHistoryAction } from './inputHandler'
import { readSelection, writeSelection } from './domSelection'
import { renderDoc } from './render'

const INITIAL_BLOCK_ID = 'b1'

function initialState(): EditorState {
  return {
    doc: { blocks: [paragraph(INITIAL_BLOCK_ID, 'Type here.')] },
    selection: null,
    pendingMarks: null,
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
      const action = toAction(event, {
        state: current,
        timestamp: Date.now(),
        newId: () => crypto.randomUUID(),
      })
      return action ? apply(current, action) : current
    })
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const action = toHistoryAction(event)
    if (!action) return

    /* Cancelled so the browser does not also try to run its own undo, which
       would rewrite the DOM behind the model's back. */
    event.preventDefault()
    setState((current) => apply(current, action))
  }, [])

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
    container.addEventListener('beforeinput', handleBeforeInput)
    container.addEventListener('keydown', handleKeyDown)
    container.ownerDocument.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      container.removeEventListener('beforeinput', handleBeforeInput)
      container.removeEventListener('keydown', handleKeyDown)
      container.ownerDocument.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [handleBeforeInput, handleKeyDown, handleSelectionChange])

  return (
    <div className="editor">
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
    </div>
  )
}
