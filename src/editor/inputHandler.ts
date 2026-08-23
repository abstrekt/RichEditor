import { effectiveMarks, isCollapsed } from '../model'
import type { Action, DeleteUnit, EditorState, Mark, Selection } from '../model'

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
 * divergence this architecture exists to prevent.
 *
 * One inputType cannot be cancelled at all: `insertCompositionText`, fired
 * during IME composition. The browser must own the DOM while composing, so
 * that case needs reconciliation suspended rather than prevented.
 */

export interface InputContext {
  readonly state: EditorState
  readonly timestamp: number
  /** Ids come from the edge, so operations stay pure functions of their
   *  inputs and tests can assert whole-document equality. */
  readonly newId: () => string
}

export function toAction(event: InputEvent, context: InputContext): Action | null {
  const { state, timestamp, newId } = context
  /*
   * Some browsers report undo and redo here, and handling them costs nothing —
   * but nothing can depend on it. Chrome only fires historyUndo when *it* has
   * something to undo, and since every input is cancelled the browser's own
   * undo stack is permanently empty, so the event never arrives. The keyboard
   * shortcuts are handled separately for that reason.
   */
  switch (event.inputType) {
    case 'historyUndo':
      return { type: 'undo' }

    case 'historyRedo':
      return { type: 'redo' }
  }

  /* Everything below acts on a selection, so without one there is nothing to
     do. Undo and redo are handled above precisely because they do not. */
  const at = state.selection
  if (!at) return null

  switch (event.inputType) {
    case 'insertText': {
      const text = event.data
      if (text === null || text.length === 0) return null
      return { type: 'insertText', at, text, marks: marksForInsertion(state), timestamp }
    }

    /* No soft-break node exists in the model, so Shift+Enter becomes a
       paragraph split. The simplification costs an address or a stanza of
       poetry becoming several blocks rather than one semantic unit. */
    case 'insertParagraph':
    case 'insertLineBreak':
      return { type: 'splitBlock', at, newBlockId: newId(), timestamp }

    case 'deleteContentBackward':
      return { type: 'deleteBackward', at, unit: 'character', timestamp }

    case 'deleteContentForward':
      return { type: 'deleteForward', at, unit: 'character', timestamp }

    case 'deleteWordBackward':
      return { type: 'deleteBackward', at, unit: 'word', timestamp }

    case 'deleteWordForward':
      return { type: 'deleteForward', at, unit: 'word', timestamp }

    /* Cmd+Backspace on macOS. Soft and hard line are the same thing here,
       since a block is never visually wrapped into separate model lines. */
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward':
      return { type: 'deleteBackward', at, unit: 'lineStart', timestamp }

    /* Ctrl+B and Ctrl+I reach us as beforeinput rather than needing a keydown
       handler, so the shortcuts come free and stay consistent with the
       platform's own bindings. */
    case 'formatBold':
      return { type: 'toggleMark', at, mark: { type: 'bold' }, timestamp }

    case 'formatItalic':
      return { type: 'toggleMark', at, mark: { type: 'italic' }, timestamp }

    /* Cut always has a range. Guarding the collapsed case stops a stray event
       from silently eating a character. */
    case 'deleteByCut':
      if (isCollapsed(at)) return null
      return { type: 'deleteBackward', at, unit: 'character', timestamp }

    /* Plain text only — a declared scope cut. Rich paste would mean walking a
       DOMParser tree against an allowlist, which is described but not built. */
    case 'insertFromPaste': {
      const text = event.dataTransfer?.getData('text/plain') ?? event.data
      if (!text) return null
      return { type: 'insertText', at, text, marks: marksForInsertion(state), timestamp }
    }

    default:
      return null
  }
}

/**
 * What formatting newly typed text should carry.
 *
 * An explicit toggle wins: pressing Ctrl+B with a collapsed caret is a
 * statement of intent, and it has to be able to contradict what would
 * otherwise be inherited — which is why pending marks are a complete mark set
 * rather than a list of marks to add.
 *
 * Otherwise text inherits from the character to its left, which is what keeps
 * a bold word bold when you carry on typing at the end of it.
 */
function marksForInsertion(state: EditorState): readonly Mark[] {
  return effectiveMarks(state)
}

/** Exported for the editor to size its own guards; not part of the model. */
export type { DeleteUnit, Selection }

/**
 * Undo and redo from the keyboard.
 *
 * These cannot come through `beforeinput`. The browser fires `historyUndo` only
 * when its own undo stack has something in it, and cancelling every input means
 * that stack is always empty — so pressing Ctrl+Z produces no input event at
 * all. It has to be caught as a key press.
 *
 * Ctrl on Windows and Linux, Cmd on macOS; both are accepted rather than
 * sniffing the platform, since no platform binds the other one to something
 * that would conflict. Ctrl+Y is included because Windows applications
 * conventionally offer it for redo alongside Ctrl+Shift+Z.
 */
export function toHistoryAction(event: KeyboardEvent): Action | null {
  if (!event.metaKey && !event.ctrlKey) return null
  if (event.altKey) return null

  const key = event.key.toLowerCase()

  if (key === 'z') return event.shiftKey ? { type: 'redo' } : { type: 'undo' }
  if (key === 'y') return { type: 'redo' }

  return null
}
