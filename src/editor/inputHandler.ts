import type { EditorState, Operation, Selection } from '../model'
import { isCollapsed } from '../model'

/**
 * Translates a browser input event into an operation against the model.
 *
 * `beforeinput` carries an `inputType` describing what the user is trying to
 * do — around thirty values in the spec, from `insertText` through
 * `formatJustifyCenter` and `insertHorizontalRule`.
 *
 * Every one of them is cancelled. Anything unhandled becomes a silent no-op
 * rather than being passed to the browser, because letting the browser write
 * would put DOM in the document that the model has no record of, which is the
 * exact divergence this architecture exists to prevent.
 *
 * One inputType cannot be cancelled at all: `insertCompositionText`, fired
 * during IME composition. The browser must own the DOM while composing, so
 * that case needs reconciliation suspended rather than prevented.
 */

export interface InputContext {
  readonly state: EditorState
  readonly timestamp: number
}

export function toOperation(event: InputEvent, context: InputContext): Operation | null {
  const { state, timestamp } = context
  const selection = state.selection
  if (!selection) return null

  switch (event.inputType) {
    case 'insertText': {
      const text = event.data
      if (text === null || text.length === 0) return null
      if (!isCollapsed(selection)) return null

      return {
        type: 'insertText',
        at: selection.anchor,
        text,
        marks: marksForInsertion(state, selection),
        timestamp,
      }
    }

    default:
      return null
  }
}

/**
 * What formatting newly typed text should carry.
 *
 * An explicit toggle wins: pressing Ctrl+B with a collapsed caret is a
 * statement of intent, and it has to be able to contradict what would otherwise
 * be inherited — which is why pending marks are a complete mark set rather than
 * a list of marks to add.
 *
 * Otherwise the text inherits from the character to its left. That is what
 * keeps a bold word bold when you carry on typing at the end of it, which is by
 * far the most common case.
 */
function marksForInsertion(state: EditorState, selection: Selection): readonly [] {
  void state
  void selection
  /* Marks are not implemented yet, so everything inserts unformatted. The
     inheritance rule lands with mark toggling. */
  return []
}
