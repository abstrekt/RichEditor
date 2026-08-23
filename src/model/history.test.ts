import { describe, expect, it } from 'vitest'
import { apply, type Action } from './apply'
import { doc, paragraph } from './doc'
import { COALESCE_WINDOW_MS, EMPTY_HISTORY, canRedo, canUndo, coalesces } from './history'
import { blockText } from './selection'
import type { EditorState, Mark, Selection } from './types'

const bold: Mark = { type: 'bold' }

const caret = (offset: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
})
const range = (from: number, to: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
})

function stateWith(document = doc([paragraph('b1', 'Hello')])): EditorState {
  return { doc: document, selection: null, pendingMarks: null, history: EMPTY_HISTORY }
}

/* Timestamps are inputs rather than read from a clock, so a run can be broken
   at an exact moment with no fake timers and no flakiness. */
const type = (at: number, text: string, timestamp: number): Action => ({
  type: 'insertText',
  at: caret(at),
  text,
  marks: [],
  timestamp,
})

const texts = (state: EditorState) => state.doc.blocks.map(blockText)

/** Types a string one character at a time, advancing the caret and the clock. */
function typeRun(state: EditorState, text: string, startAt: number, startTime = 0, step = 50) {
  let current = state
  let offset = startAt
  let time = startTime

  for (const ch of text) {
    current = apply(current, type(offset, ch, time))
    offset += ch.length
    time += step
  }
  return current
}

describe('coalesces — the rule in isolation', () => {
  const base = { type: 'insertText', blockId: 'b1', startOffset: 4, endOffset: 5, timestamp: 0 }

  it('continues a run that is contiguous, recent and in the same block', () => {
    expect(coalesces(base, { ...base, startOffset: 5, endOffset: 6, timestamp: 100 }, 'a')).toBe(true)
  })

  it('breaks when the operation kind changes', () => {
    expect(
      coalesces(base, { ...base, type: 'deleteBackward', startOffset: 5, timestamp: 100 }, null),
    ).toBe(false)
  })

  it('breaks across blocks', () => {
    expect(coalesces(base, { ...base, blockId: 'b2', startOffset: 5, timestamp: 100 }, 'a')).toBe(false)
  })

  it('breaks when the caret jumped', () => {
    /* Contiguous in time and in block, but the user clicked elsewhere — which
       is obviously a separate act. */
    expect(coalesces(base, { ...base, startOffset: 12, timestamp: 100 }, 'a')).toBe(false)
  })

  it('breaks after a pause', () => {
    expect(coalesces(base, { ...base, startOffset: 5, timestamp: COALESCE_WINDOW_MS }, 'a')).toBe(false)
    expect(
      coalesces(base, { ...base, startOffset: 5, timestamp: COALESCE_WINDOW_MS - 1 }, 'a'),
    ).toBe(true)
  })

  it('breaks on whitespace, which starts the next run rather than ending this one', () => {
    expect(coalesces(base, { ...base, startOffset: 5, timestamp: 100 }, ' ')).toBe(false)
  })

  it('has nothing to continue when there is no previous edit', () => {
    expect(coalesces(null, { ...base, startOffset: 5, timestamp: 100 }, 'a')).toBe(false)
  })
})

describe('undo through apply', () => {
  it('takes a typed word back in one step, not one per keystroke', () => {
    const typed = typeRun(stateWith(), 'world', 5)
    expect(texts(typed)).toEqual(['Helloworld'])

    const undone = apply(typed, { type: 'undo' })
    expect(texts(undone)).toEqual(['Hello'])
  })

  it('restores the selection to where it was before the edit', () => {
    /* The requirement is document *and* position — so the caret goes back to
       where it was, not to where the edit left it. */
    const start = { ...stateWith(), selection: caret(5) }
    const typed = apply(start, type(5, 'X', 0))
    expect(typed.selection).toEqual(caret(6))

    const undone = apply(typed, { type: 'undo' })
    expect(undone.selection).toEqual(caret(5))
  })

  it('splits a run at a space, leaving clean text rather than a dangling one', () => {
    const typed = typeRun(stateWith(doc([paragraph('b1', '')])), 'hello world', 0)
    expect(texts(typed)).toEqual(['hello world'])

    const once = apply(typed, { type: 'undo' })
    expect(texts(once)).toEqual(['hello'])
  })

  it('splits a run at a pause', () => {
    let state = typeRun(stateWith(), 'ab', 5, 0)
    state = typeRun(state, 'cd', 7, 5000)
    expect(texts(state)).toEqual(['Helloabcd'])

    expect(texts(apply(state, { type: 'undo' }))).toEqual(['Helloab'])
  })

  it('treats a mark toggle as its own step', () => {
    const typed = typeRun(stateWith(), 'XY', 5)
    const bolded = apply({ ...typed, selection: range(0, 5) }, {
      type: 'toggleMark', at: range(0, 5), mark: bold, timestamp: 200,
    })

    const undone = apply(bolded, { type: 'undo' })
    expect(undone.doc.blocks[0]?.spans).toEqual([{ text: 'HelloXY', marks: [] }])
    /* And the text typed before it is still there — the toggle did not merge
       into the typing run. */
    expect(texts(undone)).toEqual(['HelloXY'])
  })

  it('treats a block split as its own step', () => {
    const typed = typeRun(stateWith(), 'XY', 5)
    const split = apply(typed, {
      type: 'splitBlock', at: caret(7), newBlockId: 'b2', timestamp: 200,
    })
    expect(split.doc.blocks).toHaveLength(2)

    expect(apply(split, { type: 'undo' }).doc.blocks).toHaveLength(1)
  })

  it('does nothing with an empty history', () => {
    const before = stateWith()
    expect(apply(before, { type: 'undo' })).toBe(before)
  })

  it('does not consume a step for an edit that changed nothing', () => {
    /* Backspace at the very start of the document is a no-op, and pressing it
       should not silently eat an undo. */
    const typed = typeRun(stateWith(), 'XY', 5)
    const noop = apply({ ...typed, selection: caret(0) }, {
      type: 'deleteBackward', at: caret(0), unit: 'character', timestamp: 300,
    })

    expect(canUndo(noop.history)).toBe(canUndo(typed.history))
    expect(noop.history.past).toEqual(typed.history.past)
  })
})

describe('redo', () => {
  it('reverses an undo', () => {
    const typed = typeRun(stateWith(), 'world', 5)
    const undone = apply(typed, { type: 'undo' })
    const redone = apply(undone, { type: 'redo' })

    expect(texts(redone)).toEqual(['Helloworld'])
    expect(redone.selection).toEqual(typed.selection)
  })

  it('is discarded once a new edit happens', () => {
    /* Undo, type something, and forward is gone — which is what anyone
       expects. */
    const typed = typeRun(stateWith(), 'world', 5)
    const undone = apply(typed, { type: 'undo' })
    expect(canRedo(undone.history)).toBe(true)

    const diverged = apply({ ...undone, selection: caret(5) }, type(5, 'Z', 9000))
    expect(canRedo(diverged.history)).toBe(false)
  })

  it('does nothing with nothing to redo', () => {
    const before = stateWith()
    expect(apply(before, { type: 'redo' })).toBe(before)
  })

  it('does not merge the next keystroke into the entry it stepped back past', () => {
    const typed = typeRun(stateWith(), 'ab', 5, 0)
    const undone = apply(typed, { type: 'undo' })
    const retyped = apply({ ...undone, selection: caret(5) }, type(5, 'c', 60))

    /* Without clearing the signature on undo, this would extend the run it had
       just stepped out of, and undoing again would jump two edits back. */
    expect(texts(apply(retyped, { type: 'undo' }))).toEqual(['Hello'])
  })
})

describe('snapshot cost', () => {
  it('shares untouched blocks between history entries', () => {
    /* What makes whole-document snapshots affordable: an entry holds the same
       object for every block that did not change. */
    const start = stateWith(doc([paragraph('b1', 'one'), paragraph('b2', 'two')]))
    const typed = apply(start, type(0, 'X', 0))

    expect(typed.history.past[0]?.doc.blocks[1]).toBe(typed.doc.blocks[1])
  })
})
