import { insertTextRaw } from './operations'
import { normalizeDoc } from './normalize'
import { collapsedAt } from './selection'
import type { Doc, EditorState, Mark, Position, Selection } from './types'

/**
 * The seam where a user action becomes a state transition.
 *
 * Four things have to happen for every action, and three of them are identical
 * regardless of which action it was:
 *
 *   1. change the document      differs per operation
 *   2. normalize the result     always
 *   3. place the selection      always
 *   4. record it for undo       always
 *
 * Keeping 2-4 here rather than inside each operation means they cannot be
 * forgotten when a ninth operation is added, and a composed action — typing
 * over a selected range is a delete followed by an insert — normalizes once
 * instead of twice.
 *
 * Non-deterministic values arrive as fields on the operation rather than being
 * generated in here. That keeps every operation a pure function of its inputs,
 * so a test can assert whole-document equality instead of stripping
 * unpredictable ids and timestamps first.
 */

export type Operation = {
  readonly type: 'insertText'
  readonly at: Position
  readonly text: string
  readonly marks: readonly Mark[]
  readonly timestamp: number
}

function reduce(document: Doc, op: Operation): Doc {
  switch (op.type) {
    case 'insertText':
      return insertTextRaw(document, op.at, op.text, op.marks)

    /* No default. The operation type is a discriminated union, so adding a
       member without handling it here is a compile error rather than a silent
       fall-through. */
  }
}

/** Where the caret ends up after an operation. */
function nextSelection(op: Operation): Selection {
  switch (op.type) {
    case 'insertText':
      return collapsedAt({ blockId: op.at.blockId, offset: op.at.offset + op.text.length })
  }
}

export function apply(state: EditorState, op: Operation): EditorState {
  const doc = normalizeDoc(reduce(state.doc, op))

  return {
    doc,
    selection: nextSelection(op),
    /* Any action clears explicit formatting intent — it has either been
       consumed by the inserted text or superseded. */
    pendingMarks: null,
  }
}
