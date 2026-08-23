import { normalizeDoc } from './normalize'
import {
  EMPTY_HISTORY,
  coalesces,
  extend,
  record,
  type EditSignature,
  type History,
  type Snapshot,
} from './history'
import { effectiveMarks, shouldRemove } from './marksAt'
import { isCollapsed } from './selection'
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

/**
 * Undo and redo are actions on the session rather than operations on the
 * document: they restore a snapshot that is already canonical, so they skip
 * both the reducer and normalization. Routing them through the same entry point
 * keeps one definition of "a thing the user did".
 */
export type Action = Operation | { readonly type: 'undo' } | { readonly type: 'redo' }

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

/** Only edits that change text can run together; structural and formatting
 *  changes are always their own undo step. */
function signatureFor(op: Operation, result: OperationResult): EditSignature | null {
  if (op.type === 'toggleMark' || op.type === 'splitBlock') return null

  /* Replacing a selection is a discrete act, not part of a run of typing —
     nobody expects one Ctrl+Z to take back both the replacement and the
     characters typed after it. */
  if (!isCollapsed(op.at)) return null

  return {
    type: op.type,
    blockId: result.selection.focus.blockId,
    startOffset: op.at.focus.offset,
    endOffset: result.selection.focus.offset,
    timestamp: op.timestamp,
  }
}

function recordHistory(state: EditorState, op: Operation, result: OperationResult): History {
  const signature = signatureFor(op, result)
  const snapshot: Snapshot = { doc: state.doc, selection: state.selection }

  if (!signature) return record(state.history, snapshot, { ...EMPTY_SIGNATURE })

  const insertedText = op.type === 'insertText' ? op.text : null
  const continuing = coalesces(state.history.lastEdit, signature, insertedText)

  /* Continuing keeps the snapshot already on the stack, because that is the
     state before the run started — which is where undo should land. */
  return continuing
    ? extend(state.history, signature)
    : record(state.history, snapshot, signature)
}

/* A signature that can never match, so the next edit always starts a new
   entry. Used for changes that are always their own undo step. */
const EMPTY_SIGNATURE: EditSignature = {
  type: '\u0000never',
  blockId: '',
  startOffset: -1,
  endOffset: -1,
  timestamp: Number.NEGATIVE_INFINITY,
}

function restore(snapshot: Snapshot, history: History): EditorState {
  return {
    doc: snapshot.doc,
    selection: snapshot.selection,
    /* Formatting intent does not survive a jump through history — it described
       a caret that no longer exists. */
    pendingMarks: null,
    history,
  }
}

export function apply(state: EditorState, action: Action): EditorState {
  if (action.type === 'undo') {
    const previous = state.history.past[state.history.past.length - 1]
    if (!previous) return state

    return restore(previous, {
      past: state.history.past.slice(0, -1),
      future: [...state.history.future, { doc: state.doc, selection: state.selection }],
      /* Clearing this stops the next keystroke from merging into the entry we
         just stepped back past. */
      lastEdit: null,
    })
  }

  if (action.type === 'redo') {
    const next = state.history.future[state.history.future.length - 1]
    if (!next) return state

    return restore(next, {
      past: [...state.history.past, { doc: state.doc, selection: state.selection }],
      future: state.history.future.slice(0, -1),
      lastEdit: null,
    })
  }

  const result = reduce(state, action)
  const doc = normalizeDoc(result.doc)

  /* A no-op — backspace at the very start of the document, or an insert of
     nothing — should not consume an undo step. */
  if (doc === state.doc && result.pendingMarks === state.pendingMarks) {
    return { ...state, selection: result.selection }
  }

  return {
    doc,
    selection: result.selection,
    /* Most operations clear formatting intent — it has either been consumed by
       the text just inserted or superseded by what happened. Toggling with a
       collapsed caret is the exception: recording that intent is the whole
       point of it. */
    pendingMarks: result.pendingMarks,
    history: recordHistory(state, action, result),
  }
}

export { EMPTY_HISTORY }
