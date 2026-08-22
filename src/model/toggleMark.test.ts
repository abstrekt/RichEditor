import { describe, expect, it } from 'vitest'
import { apply } from './apply'
import { block, doc, paragraph, span } from './doc'
import { shouldRemove } from './marksAt'
import { blockText } from './selection'
import type { EditorState, Mark, Selection } from './types'

const bold: Mark = { type: 'bold' }
const italic: Mark = { type: 'italic' }

const caret = (offset: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
})
const range = (from: number, to: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
})

/*  "Hello world" with "world" bold.
 *
 *      H  e  l  l  o     w  o  r  l  d
 *     0  1  2  3  4  5  6  7  8  9 10 11
 *                        |____bold____|
 */
const mixed = doc([block('b1', [span('Hello '), span('world', [bold])])])
const state = (document = mixed, selection: Selection | null = null): EditorState => ({
  doc: document,
  selection,
  pendingMarks: null,
})

describe('the toggle rule — R4', () => {
  /* The brief names this case specifically: what happens when you toggle bold
     on a range that is already partially bold. */

  it('adds to all when the range is partly marked', () => {
    expect(shouldRemove(state(mixed, range(3, 11)), 'bold')).toBe(false)

    const next = apply(state(mixed, range(3, 11)), {
      type: 'toggleMark', at: range(3, 11), mark: bold, timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans).toEqual([
      { text: 'Hel', marks: [] },
      { text: 'lo world', marks: [bold] },
    ])
  })

  it('removes from all only when every character already carries it', () => {
    expect(shouldRemove(state(mixed, range(6, 11)), 'bold')).toBe(true)

    const next = apply(state(mixed, range(6, 11)), {
      type: 'toggleMark', at: range(6, 11), mark: bold, timestamp: 0,
    })
    /* Removing the mark makes the two spans identical, so normalization
       merges them — which is why "same document" and "deep-equal" agree. */
    expect(next.doc.blocks[0]?.spans).toEqual([{ text: 'Hello world', marks: [] }])
  })

  it('is its own inverse on a fully marked range', () => {
    const on = apply(state(mixed, range(0, 11)), {
      type: 'toggleMark', at: range(0, 11), mark: bold, timestamp: 0,
    })
    const off = apply({ ...on, selection: range(0, 11) }, {
      type: 'toggleMark', at: range(0, 11), mark: bold, timestamp: 0,
    })
    expect(blockText(off.doc.blocks[0]!)).toBe('Hello world')
    expect(off.doc.blocks[0]?.spans).toEqual([{ text: 'Hello world', marks: [] }])
  })

  it('composes marks rather than replacing them', () => {
    const next = apply(state(mixed, range(6, 11)), {
      type: 'toggleMark', at: range(6, 11), mark: italic, timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans[1]?.marks).toEqual([bold, italic])
  })

  it('applies across a range spanning two blocks', () => {
    const twoBlocks = doc([paragraph('b1', 'first'), paragraph('b2', 'second')])
    const across: Selection = {
      anchor: { blockId: 'b1', offset: 2 },
      focus: { blockId: 'b2', offset: 3 },
    }
    const next = apply(state(twoBlocks, across), {
      type: 'toggleMark', at: across, mark: bold, timestamp: 0,
    })

    expect(next.doc.blocks[0]?.spans).toEqual([
      { text: 'fi', marks: [] },
      { text: 'rst', marks: [bold] },
    ])
    expect(next.doc.blocks[1]?.spans).toEqual([
      { text: 'sec', marks: [bold] },
      { text: 'ond', marks: [] },
    ])
  })
})

describe('toggling with a collapsed caret', () => {
  it('changes no text and records intent instead', () => {
    const before = state(mixed, caret(3))
    const next = apply(before, { type: 'toggleMark', at: caret(3), mark: bold, timestamp: 0 })

    expect(next.doc).toBe(before.doc)
    expect(next.pendingMarks).toEqual([bold])
  })

  it('can express "not bold" against an affinity that says bold', () => {
    /* Caret after a bold word: affinity would inherit bold, so the toggle has
       to be able to contradict it. A list of marks to *add* could not. */
    const next = apply(state(mixed, caret(11)), {
      type: 'toggleMark', at: caret(11), mark: bold, timestamp: 0,
    })
    expect(next.pendingMarks).toEqual([])
  })

  it('applies the recorded intent to the next typed character', () => {
    const toggled = apply(state(mixed, caret(3)), {
      type: 'toggleMark', at: caret(3), mark: bold, timestamp: 0,
    })
    const typed = apply(toggled, {
      type: 'insertText', at: caret(3), text: 'X', marks: toggled.pendingMarks ?? [], timestamp: 1,
    })

    expect(typed.doc.blocks[0]?.spans[1]).toEqual({ text: 'X', marks: [bold] })
    /* And the intent is spent. */
    expect(typed.pendingMarks).toBeNull()
  })
})
