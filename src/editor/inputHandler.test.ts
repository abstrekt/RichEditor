import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, doc, paragraph } from '../model'
import type { EditorState, Selection } from '../model'
import { toAction, toHistoryAction, type InputSignal, type KeySignal } from './inputHandler'

/*
 * These run in the node environment alongside the model tests, with no DOM and
 * no fabricated event objects, because the mapping takes plain data rather than
 * an InputEvent. Deciding what Ctrl+Backspace means is a pure question and is
 * tested as one.
 */

const caret = (offset: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
})
const range = (from: number, to: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
})

const stateWith = (selection: Selection | null): EditorState => ({
  doc: doc([paragraph('b1', 'Hello world')]),
  selection,
  pendingMarks: null,
  history: EMPTY_HISTORY,
})

const signal = (inputType: string, over: Partial<InputSignal> = {}): InputSignal => ({
  inputType,
  data: null,
  clipboardText: null,
  ...over,
})

const context = (selection: Selection | null = caret(5)) => ({
  state: stateWith(selection),
  timestamp: 1000,
  newId: () => 'new-block',
})

describe('text input', () => {
  it('maps typing to an insertion carrying the caret', () => {
    expect(toAction(signal('insertText', { data: 'x' }), context())).toEqual({
      type: 'insertText',
      at: caret(5),
      text: 'x',
      marks: [],
      timestamp: 1000,
    })
  })

  it('ignores an insertion with no data', () => {
    expect(toAction(signal('insertText'), context())).toBeNull()
    expect(toAction(signal('insertText', { data: '' }), context())).toBeNull()
  })

  it('passes a selected range through, so typing replaces it', () => {
    const action = toAction(signal('insertText', { data: 'x' }), context(range(0, 5)))
    expect(action).toMatchObject({ type: 'insertText', at: range(0, 5) })
  })
})

describe('block boundaries', () => {
  it('maps Enter to a split, supplying an id from the edge', () => {
    expect(toAction(signal('insertParagraph'), context())).toEqual({
      type: 'splitBlock',
      at: caret(5),
      newBlockId: 'new-block',
      timestamp: 1000,
    })
  })

  it('maps Shift+Enter to a split as well, since there is no soft break', () => {
    expect(toAction(signal('insertLineBreak'), context())).toMatchObject({ type: 'splitBlock' })
  })
})

describe('deletion units', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['deleteContentBackward', 'deleteBackward', 'character'],
    ['deleteContentForward', 'deleteForward', 'character'],
    ['deleteWordBackward', 'deleteBackward', 'word'],
    ['deleteWordForward', 'deleteForward', 'word'],
    ['deleteSoftLineBackward', 'deleteBackward', 'lineStart'],
    ['deleteHardLineBackward', 'deleteBackward', 'lineStart'],
  ]

  for (const [inputType, type, unit] of cases) {
    it(`maps ${inputType} to ${type} by ${unit}`, () => {
      expect(toAction(signal(inputType), context())).toMatchObject({ type, unit })
    })
  }
})

describe('cut', () => {
  it('deletes the selected range', () => {
    expect(toAction(signal('deleteByCut'), context(range(0, 5)))).toMatchObject({
      type: 'deleteBackward',
    })
  })

  it('does nothing with a collapsed caret', () => {
    /* Cut always has a range; guarding this stops a stray event from silently
       eating a character. */
    expect(toAction(signal('deleteByCut'), context(caret(5)))).toBeNull()
  })
})

describe('paste', () => {
  it('inserts the clipboard as plain text', () => {
    const action = toAction(
      signal('insertFromPaste', { clipboardText: 'pasted' }),
      context(),
    )
    expect(action).toMatchObject({ type: 'insertText', text: 'pasted' })
  })

  it('falls back to the event data when there is no clipboard text', () => {
    const action = toAction(signal('insertFromPaste', { data: 'fallback' }), context())
    expect(action).toMatchObject({ type: 'insertText', text: 'fallback' })
  })

  it('ignores an empty paste', () => {
    expect(toAction(signal('insertFromPaste'), context())).toBeNull()
  })
})

describe('formatting', () => {
  it('maps the bold and italic input types to a toggle', () => {
    expect(toAction(signal('formatBold'), context())).toMatchObject({
      type: 'toggleMark',
      mark: { type: 'bold' },
    })
    expect(toAction(signal('formatItalic'), context())).toMatchObject({
      type: 'toggleMark',
      mark: { type: 'italic' },
    })
  })
})

describe('everything else', () => {
  it('is ignored rather than passed to the browser', () => {
    /* Letting the browser handle an unsupported input would write DOM the
       model has no record of, which is the divergence this design exists to
       prevent. Silently doing nothing is the defensible half. */
    const unsupported = [
      'insertOrderedList',
      'insertUnorderedList',
      'insertHorizontalRule',
      'formatUnderline',
      'formatStrikeThrough',
      'formatJustifyCenter',
      'formatIndent',
      'formatBackColor',
      'insertTranspose',
      'insertFromDrop',
      'deleteByDrag',
    ]
    for (const inputType of unsupported) {
      expect(toAction(signal(inputType), context()), inputType).toBeNull()
    }
  })

  it('does nothing at all without a selection', () => {
    expect(toAction(signal('insertText', { data: 'x' }), context(null))).toBeNull()
    expect(toAction(signal('deleteContentBackward'), context(null))).toBeNull()
  })
})

describe('undo and redo shortcuts', () => {
  const key = (over: Partial<KeySignal>): KeySignal => ({
    key: 'z',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  })

  it('accepts either modifier, so no platform sniffing is needed', () => {
    expect(toHistoryAction(key({ metaKey: true }))).toEqual({ type: 'undo' })
    expect(toHistoryAction(key({ ctrlKey: true }))).toEqual({ type: 'undo' })
  })

  it('redoes with shift', () => {
    expect(toHistoryAction(key({ metaKey: true, shiftKey: true }))).toEqual({ type: 'redo' })
  })

  it('accepts Ctrl+Y, which Windows applications conventionally offer', () => {
    expect(toHistoryAction(key({ key: 'y', ctrlKey: true }))).toEqual({ type: 'redo' })
  })

  it('is case-insensitive, since shift changes the reported key', () => {
    expect(toHistoryAction(key({ key: 'Z', metaKey: true, shiftKey: true }))).toEqual({
      type: 'redo',
    })
  })

  it('ignores the key without a modifier', () => {
    expect(toHistoryAction(key({}))).toBeNull()
  })

  it('ignores it when alt is held, which usually means something else', () => {
    expect(toHistoryAction(key({ metaKey: true, altKey: true }))).toBeNull()
  })

  it('ignores unrelated keys', () => {
    expect(toHistoryAction(key({ key: 'a', metaKey: true }))).toBeNull()
  })
})
