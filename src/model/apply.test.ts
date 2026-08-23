import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, apply, type Operation } from './apply'
import { block, doc, paragraph, span } from './doc'
import { blockText } from './selection'
import type { EditorState, Mark, Selection } from './types'

const bold: Mark = { type: 'bold' }

/* Timestamps and new block ids are inputs rather than values the operation
   generates, so every assertion below is exact rather than approximate. */
const caret = (offset: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
})

const range = (from: number, to: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
})

const across = (
  fromBlock: string,
  fromOffset: number,
  toBlock: string,
  toOffset: number,
): Selection => ({
  anchor: { blockId: fromBlock, offset: fromOffset },
  focus: { blockId: toBlock, offset: toOffset },
})

function stateWith(document = doc([paragraph('b1', 'Hello world')])): EditorState {
  return { doc: document, selection: null, pendingMarks: null, history: EMPTY_HISTORY }
}

const run = (state: EditorState, op: Operation) => apply(state, op)
const texts = (state: EditorState) => state.doc.blocks.map(blockText)

describe('insertText', () => {
  it('inserts at the caret', () => {
    const next = run(stateWith(), {
      type: 'insertText', at: caret(5), text: ',', marks: [], timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello, world'])
    expect(next.selection).toEqual(caret(6))
  })

  it('inserts at the start and end of a block', () => {
    const start = run(stateWith(), {
      type: 'insertText', at: caret(0), text: '> ', marks: [], timestamp: 0,
    })
    expect(texts(start)).toEqual(['> Hello world'])

    const end = run(stateWith(), {
      type: 'insertText', at: caret(11), text: '!', marks: [], timestamp: 0,
    })
    expect(texts(end)).toEqual(['Hello world!'])
  })

  it('inserts into an empty block without a special case', () => {
    const next = run(stateWith(doc([paragraph('b1', '')])), {
      type: 'insertText', at: caret(0), text: 'a', marks: [], timestamp: 0,
    })
    expect(texts(next)).toEqual(['a'])
  })

  it('replaces a selected range', () => {
    /* The reason operations take a selection rather than a position: this is
       one operation, so it normalizes once and takes one undo to reverse. */
    const next = run(stateWith(), {
      type: 'insertText', at: range(6, 11), text: 'there', marks: [], timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello there'])
    expect(next.selection).toEqual(caret(11))
  })

  it('replaces a range selected backwards', () => {
    const next = run(stateWith(), {
      type: 'insertText', at: range(11, 6), text: 'there', marks: [], timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello there'])
  })

  it('replaces a range spanning two blocks', () => {
    const state = stateWith(doc([paragraph('b1', 'Hello'), paragraph('b2', 'world')]))
    const next = run(state, {
      type: 'insertText', at: across('b1', 2, 'b2', 3), text: '-', marks: [], timestamp: 0,
    })
    expect(texts(next)).toEqual(['He-ld'])
  })

  it('normalizes, so inserted text merges into a neighbour with the same marks', () => {
    const next = run(stateWith(), {
      type: 'insertText', at: caret(5), text: ',', marks: [], timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans).toHaveLength(1)
  })

  it('keeps inserted text in its own span when its marks differ', () => {
    const next = run(stateWith(), {
      type: 'insertText', at: caret(5), text: 'BOLD', marks: [bold], timestamp: 0,
    })
    const spans = next.doc.blocks[0]!.spans
    expect(spans).toHaveLength(3)
    expect(spans[1]).toEqual({ text: 'BOLD', marks: [bold] })
  })

  it('shares untouched blocks with the previous document', () => {
    const before = stateWith(doc([paragraph('b1', 'one'), paragraph('b2', 'two')]))
    const next = run(before, {
      type: 'insertText', at: caret(0), text: 'X', marks: [], timestamp: 0,
    })
    expect(next.doc.blocks[1]).toBe(before.doc.blocks[1])
  })

  it('does not mutate the document it was given', () => {
    const before = stateWith()
    const snapshot = JSON.stringify(before.doc)
    run(before, { type: 'insertText', at: caret(5), text: 'XYZ', marks: [], timestamp: 0 })
    expect(JSON.stringify(before.doc)).toBe(snapshot)
  })

  it('rejects a position pointing at a block that no longer exists', () => {
    expect(() =>
      run(stateWith(), {
        type: 'insertText', at: caret(0, 'gone'), text: 'x', marks: [], timestamp: 0,
      }),
    ).toThrow(/No block with id/)
  })
})

describe('deleteBackward', () => {
  it('removes one character before the caret', () => {
    const next = run(stateWith(), {
      type: 'deleteBackward', at: caret(5), unit: 'character', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hell world'])
    expect(next.selection).toEqual(caret(4))
  })

  it('removes a whole emoji rather than part of one', () => {
    /* Deleting one code unit splits a surrogate pair; deleting one code point
       turns a four-person family emoji into a three-person one. */
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    const state = stateWith(doc([paragraph('b1', `a${family}`)]))
    const next = run(state, {
      type: 'deleteBackward', at: caret(1 + family.length), unit: 'character', timestamp: 0,
    })
    expect(texts(next)).toEqual(['a'])
  })

  it('removes a word', () => {
    const next = run(stateWith(), {
      type: 'deleteBackward', at: caret(11), unit: 'word', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello '])
  })

  it('removes to the start of the block', () => {
    const next = run(stateWith(), {
      type: 'deleteBackward', at: caret(5), unit: 'lineStart', timestamp: 0,
    })
    expect(texts(next)).toEqual([' world'])
  })

  it('removes the selection and ignores the unit when a range is selected', () => {
    const next = run(stateWith(), {
      type: 'deleteBackward', at: range(5, 11), unit: 'word', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello'])
  })

  it('merges into the previous block at offset zero', () => {
    const state = stateWith(doc([paragraph('b1', 'Hello'), paragraph('b2', 'world')]))
    const next = run(state, {
      type: 'deleteBackward', at: caret(0, 'b2'), unit: 'character', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Helloworld'])
    /* The caret lands at the join, which is where the previous block ended. */
    expect(next.selection).toEqual(caret(5, 'b1'))
  })

  it('does nothing at the start of the first block', () => {
    /* No block above to merge into. Silently doing nothing beats inventing a
       behaviour. */
    const before = stateWith()
    const next = run(before, {
      type: 'deleteBackward', at: caret(0), unit: 'character', timestamp: 0,
    })
    expect(next.doc).toEqual(before.doc)
  })

  it('leaves an emptied block holding one empty span', () => {
    const next = run(stateWith(doc([paragraph('b1', 'a')])), {
      type: 'deleteBackward', at: caret(1), unit: 'character', timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans).toEqual([{ text: '', marks: [] }])
  })
})

describe('deleteForward', () => {
  it('removes one character after the caret', () => {
    const next = run(stateWith(), {
      type: 'deleteForward', at: caret(5), unit: 'character', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Helloworld'])
    expect(next.selection).toEqual(caret(5))
  })

  it('removes a word', () => {
    const next = run(stateWith(), {
      type: 'deleteForward', at: caret(0), unit: 'word', timestamp: 0,
    })
    expect(texts(next)).toEqual([' world'])
  })

  it('pulls the next block up at the end of a block', () => {
    const state = stateWith(doc([paragraph('b1', 'Hello'), paragraph('b2', 'world')]))
    const next = run(state, {
      type: 'deleteForward', at: caret(5, 'b1'), unit: 'character', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Helloworld'])
  })

  it('does nothing at the end of the last block', () => {
    const before = stateWith()
    const next = run(before, {
      type: 'deleteForward', at: caret(11), unit: 'character', timestamp: 0,
    })
    expect(next.doc).toEqual(before.doc)
  })
})

describe('splitBlock', () => {
  it('splits at the caret, leaving the caret at the start of the new block', () => {
    const next = run(stateWith(), {
      type: 'splitBlock', at: caret(5), newBlockId: 'b2', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello', ' world'])
    expect(next.selection).toEqual(caret(0, 'b2'))
  })

  it('keeps the original id on the first half', () => {
    /* So the existing DOM element is reused for the text the caret is
       leaving, and only the new block is created. */
    const next = run(stateWith(), {
      type: 'splitBlock', at: caret(5), newBlockId: 'b2', timestamp: 0,
    })
    expect(next.doc.blocks.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('splits at the end, producing an empty block that holds one empty span', () => {
    const next = run(stateWith(), {
      type: 'splitBlock', at: caret(11), newBlockId: 'b2', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello world', ''])
    expect(next.doc.blocks[1]?.spans).toEqual([{ text: '', marks: [] }])
  })

  it('splits at the start, leaving an empty block above', () => {
    const next = run(stateWith(), {
      type: 'splitBlock', at: caret(0), newBlockId: 'b2', timestamp: 0,
    })
    expect(texts(next)).toEqual(['', 'Hello world'])
  })

  it('carries formatting onto the new block', () => {
    /* Press Enter at the end of a bold line and keep typing: still bold. The
       empty span's marks slot is where that intent survives. */
    const state = stateWith(doc([block('b1', [span('Hello', [bold])])]))
    const next = run(state, {
      type: 'splitBlock', at: caret(5), newBlockId: 'b2', timestamp: 0,
    })
    expect(next.doc.blocks[1]?.spans[0]?.marks).toEqual([bold])
  })

  it('deletes a selected range before splitting', () => {
    const next = run(stateWith(), {
      type: 'splitBlock', at: range(5, 11), newBlockId: 'b2', timestamp: 0,
    })
    expect(texts(next)).toEqual(['Hello', ''])
  })
})
