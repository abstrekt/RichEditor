import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apply, paragraph } from '../model'
import type { EditorState } from '../model'
import { toOperation } from './inputHandler'
import { readSelection, writeSelection } from './domSelection'
import { renderDoc } from './render'

const INITIAL_BLOCK_ID = 'b1'

function initialState(): EditorState {
  return {
    doc: { blocks: [paragraph(INITIAL_BLOCK_ID, 'Type here.')] },
    selection: null,
    pendingMarks: null,
  }
}

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<EditorState>(initialState)

  /*
   * Writing the selection fires selectionchange, which would read it straight
   * back and schedule another render. The flag marks the window during which
   * that event is our own echo rather than something the user did.
   *
   * A ref rather than state: it has to be readable synchronously inside an
   * event listener, and changing it must not itself cause a render.
   */
  const applyingSelection = useRef(false)

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
      applyingSelection.current = true
      writeSelection(container, state.selection)
      /* Cleared in a microtask because selectionchange is dispatched
         asynchronously — clearing synchronously would reopen the loop before
         the echo arrives. */
      queueMicrotask(() => {
        applyingSelection.current = false
      })
    }
  }, [state])

  const handleBeforeInput = useCallback((event: InputEvent) => {
    /* Cancel first, unconditionally. Deciding whether we handle this input
       comes second — the browser must not write here regardless of the answer. */
    event.preventDefault()

    setState((current) => {
      const operation = toOperation(event, {
        state: current,
        timestamp: Date.now(),
        newId: () => crypto.randomUUID(),
      })
      return operation ? apply(current, operation) : current
    })
  }, [])

  const handleSelectionChange = useCallback(() => {
    if (applyingSelection.current) return

    const container = containerRef.current
    if (!container) return

    setState((current) => {
      const selection = readSelection(container, current.doc)
      return selection ? { ...current, selection, pendingMarks: null } : current
    })
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    /* Attached directly rather than through React's synthetic events: React's
       onBeforeInput has historically mapped to a different underlying event,
       and this needs the real one with its inputType intact. */
    container.addEventListener('beforeinput', handleBeforeInput)
    container.ownerDocument.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      container.removeEventListener('beforeinput', handleBeforeInput)
      container.ownerDocument.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [handleBeforeInput, handleSelectionChange])

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
