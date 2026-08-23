import type { Doc, Selection } from './types'

/**
 * Undo history.
 *
 * Whole-document snapshots rather than inverse operations. The obvious
 * objection is memory — a copy of the document per keystroke — but the
 * operations are immutable and share structure, so an edited document reuses
 * the same object references for every block that did not change. A snapshot
 * costs one new block, not one new document.
 *
 * The alternative would be storing an operation that undoes each change. It is
 * genuinely more compact and it is the foundation collaborative editing needs,
 * but every operation would need a correct inverse that also accounts for
 * normalization having reshaped the result afterwards. That is several more
 * places to be subtly wrong, in a system where subtly wrong means the user
 * silently loses text.
 *
 * Selection is part of the snapshot rather than stored beside it, so undo
 * restores the caret to where it was before the edit — the requirement being
 * to restore document *and* position — and the two cannot drift apart.
 */

export interface Snapshot {
  readonly doc: Doc
  readonly selection: Selection | null
}

/** What produced the most recent entry, so the next edit can decide whether it
 *  continues that entry or starts a new one. */
export interface EditSignature {
  readonly type: string
  readonly blockId: string
  /** Where the caret sat before this edit. */
  readonly startOffset: number
  /** Where the caret finished. A continuing edit has to begin exactly here. */
  readonly endOffset: number
  readonly timestamp: number
}

export interface History {
  readonly past: readonly Snapshot[]
  readonly future: readonly Snapshot[]
  readonly lastEdit: EditSignature | null
}

export const EMPTY_HISTORY: History = { past: [], future: [], lastEdit: null }

/**
 * How long a pause breaks a run of typing.
 *
 * Short enough that a deliberate pause reads as a separate act; long enough not
 * to chop up fast typing. Measured from the last keystroke rather than the
 * start of the run, so continuous typing extends indefinitely and any pause of
 * this length ends it.
 */
export const COALESCE_WINDOW_MS = 500

/**
 * Whether an edit continues the previous history entry rather than starting a
 * new one.
 *
 * Without this, typing "hello" leaves five entries and removing one word takes
 * five presses of Ctrl+Z. Undo should work in units of intent — roughly a word,
 * or a burst of typing.
 *
 * All five conditions must hold. The timestamp is a parameter rather than read
 * from a clock inside here, so the rule stays a pure function and a test can
 * hand it t=0 and t=600 and assert the run broke, without fake timers.
 */
export function coalesces(
  previous: EditSignature | null,
  next: EditSignature,
  insertedText: string | null,
): boolean {
  if (!previous) return false

  /* An insert never continues a delete, and neither continues a structural
     change. */
  if (previous.type !== next.type) return false

  if (previous.blockId !== next.blockId) return false

  /* Contiguity means this edit begins exactly where the last one finished.
     Clicking elsewhere in the same block and typing is contiguous in time and
     in block but not in position, and is obviously a separate act.

     This holds in both directions: typing at 5 ends at 6 and the next
     keystroke starts at 6; backspacing at 5 ends at 4 and the next backspace
     starts at 4. */
  if (previous.endOffset !== next.startOffset) return false

  if (next.timestamp - previous.timestamp >= COALESCE_WINDOW_MS) return false

  /* Whitespace starts the next run rather than ending the current one, so
     undoing "hello world" leaves "hello" rather than "hello " with a dangling
     space. */
  if (insertedText !== null && /^\s/.test(insertedText)) return false

  return true
}

/** Entries beyond this are dropped from the oldest end. Snapshots are cheap,
 *  but not free, and no one undoes a hundred steps. */
export const MAX_ENTRIES = 100

export function record(history: History, snapshot: Snapshot, edit: EditSignature): History {
  const past = [...history.past, snapshot]

  return {
    past: past.length > MAX_ENTRIES ? past.slice(past.length - MAX_ENTRIES) : past,
    /* A new edit discards the redo path, which is what anyone expects: undo
       three times, type something, and forward is gone. */
    future: [],
    lastEdit: edit,
  }
}

/** Extends the entry already on top instead of adding another. The snapshot
 *  stays as it was — it is the state *before* the run began, which is where
 *  undo should land. */
export function extend(history: History, edit: EditSignature): History {
  return { past: history.past, future: [], lastEdit: edit }
}

export function canUndo(history: History): boolean {
  return history.past.length > 0
}

export function canRedo(history: History): boolean {
  return history.future.length > 0
}
