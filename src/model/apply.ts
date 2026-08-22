import { normalizeDoc } from './normalize'
import { effectiveMarks, shouldRemove } from './marksAt'
import {
  deleteBackwardRaw,
  deleteForwardRaw,
  insertTextRaw,
  splitBlockRaw,
  toggleMarkRaw,
  type DeleteUnit,
  type OperationResult,
} from './operations'
import type { EditorState, Mark, Selection } from './types'

/**
 * The seam where a user action becomes a state transition.
 *
 * Four things happen for every action, and three are identical whatever the
 * action was:
 *
 *   1. change the document      differs per operation
 *   2. normalize the result     always
 *   3. place the selection      always
 *   4. record it for undo       always
 *
 * Keeping 2-4 here rather than inside each operation means they cannot be
 * forgotten when another operation is added, and it gives one definition of
 * "one user action" rather than two competing ones.
 *
 * Non-deterministic values — new block ids, timestamps — arrive as fields on
 * the operation rather than being generated in here, so every operation stays a
 * pure function of its inputs and a test can assert whole-document equality
 * instead of stripping unpredictable fields first.
 */

export type Operation =
  | {
      readonly type: 'insertText'
      readonly at: Selection
      readonly text: string
      readonly marks: readonly Mark[]
      readonly timestamp: number
    }
  | {
      readonly type: 'deleteBackward'
      readonly at: Selection
      readonly unit: DeleteUnit
      readonly timestamp: number
    }
  | {
      readonly type: 'deleteForward'
      readonly at: Selection
      readonly unit: DeleteUnit
      readonly timestamp: number
    }
  | {
      readonly type: 'splitBlock'
      readonly at: Selection
      readonly newBlockId: string
      readonly timestamp: number
    }
  | {
      /* The mark carries its attributes, because adding a link needs an href
         while removing one only needs the type. */
      readonly type: 'toggleMark'
      readonly at: Selection
      readonly mark: Mark
      readonly timestamp: number
    }

function reduce(state: EditorState, op: Operation): OperationResult {
  const document = state.doc

  switch (op.type) {
    case 'insertText':
      return insertTextRaw(document, op.at, op.text, op.marks)

    case 'deleteBackward':
      return deleteBackwardRaw(document, op.at, op.unit)

    case 'deleteForward':
      return deleteForwardRaw(document, op.at, op.unit)

    case 'splitBlock':
      return splitBlockRaw(document, op.at, op.newBlockId)

    case 'toggleMark':
      /* Whether this adds or removes is a question about the current state, not
         about the operation, so it is answered here rather than baked into the
         event that produced it. */
      return toggleMarkRaw(
        document,
        op.at,
        op.mark,
        shouldRemove({ ...state, selection: op.at }, op.mark.type),
        effectiveMarks({ ...state, selection: op.at }),
      )

    /* No default. Operations are a discriminated union, so adding a member
       without handling it here is a compile error rather than a silent
       fall-through. */
  }
}

export function apply(state: EditorState, op: Operation): EditorState {
  const result = reduce(state, op)

  return {
    doc: normalizeDoc(result.doc),
    selection: result.selection,
    /* Most operations clear formatting intent — it has either been consumed by
       the text just inserted or superseded by what happened. Toggling with a
       collapsed caret is the exception: recording that intent is the whole
       point of it. */
    pendingMarks: result.pendingMarks,
  }
}
