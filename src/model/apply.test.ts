import { describe, expect, it } from 'vitest'
import { apply } from './apply'
import { block, doc, paragraph, span } from './doc'
import { blockText } from './selection'
import type { EditorState, Mark } from './types'

const bold: Mark = { type: 'bold' }

function stateWith(document = doc([paragraph('b1', 'Hello world')])): EditorState {
  return { doc: document, selection: null, pendingMarks: null }
}

/* Operations take their timestamp as an input rather than reading a clock, so
   these assertions are exact rather than approximate. */
const at = (offset: number) => ({ blockId: 'b1', offset })

describe('insertText', () => {
  it('inserts at the caret', () => {
    const next = apply(stateWith(), {
      type: 'insertText',
      at: at(5),
      text: ',',
      marks: [],
      timestamp: 0,
    })
    expect(blockText(next.doc.blocks[0]!)).toBe('Hello, world')
  })

  it('inserts at the start of a block', () => {
    const next = apply(stateWith(), {
      type: 'insertText',
      at: at(0),
      text: '> ',
      marks: [],
      timestamp: 0,
    })
    expect(blockText(next.doc.blocks[0]!)).toBe('> Hello world')
  })

  it('inserts at the end of a block', () => {
    const next = apply(stateWith(), {
      type: 'insertText',
      at: at(11),
      text: '!',
      marks: [],
      timestamp: 0,
    })
    expect(blockText(next.doc.blocks[0]!)).toBe('Hello world!')
  })

  it('inserts into an empty block', () => {
    /* The empty block holds one empty span precisely so this needs no special
       case — it is the same code path as any other insertion. */
    const next = apply(stateWith(doc([paragraph('b1', '')])), {
      type: 'insertText',
      at: at(0),
      text: 'a',
      marks: [],
      timestamp: 0,
    })
    expect(blockText(next.doc.blocks[0]!)).toBe('a')
  })

  it('moves the caret to the end of what was inserted', () => {
    const next = apply(stateWith(), {
      type: 'insertText',
      at: at(5),
      text: 'XYZ',
      marks: [],
      timestamp: 0,
    })
    expect(next.selection).toEqual({
      anchor: { blockId: 'b1', offset: 8 },
      focus: { blockId: 'b1', offset: 8 },
    })
  })

  it('normalizes the result, so unmarked text merges into its neighbour', () => {
    /* The raw operation splits the target span and inserts between the halves,
       leaving three spans with identical marks. Nothing downstream should ever
       see that intermediate shape. */
    const next = apply(stateWith(), {
      type: 'insertText',
      at: at(5),
      text: ',',
      marks: [],
      timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans).toHaveLength(1)
  })

  it('keeps inserted text in its own span when its marks differ', () => {
    const next = apply(stateWith(), {
      type: 'insertText',
      at: at(5),
      text: 'BOLD',
      marks: [bold],
      timestamp: 0,
    })
    const spans = next.doc.blocks[0]!.spans
    expect(spans).toHaveLength(3)
    expect(spans[1]).toEqual({ text: 'BOLD', marks: [bold] })
  })

  it('merges inserted text into an adjacent span carrying the same marks', () => {
    const document = doc([block('b1', [span('Hello '), span('world', [bold])])])
    const next = apply(stateWith(document), {
      type: 'insertText',
      at: at(8),
      text: 'XX',
      marks: [bold],
      timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans).toHaveLength(2)
    expect(blockText(next.doc.blocks[0]!)).toBe('Hello woXXrld')
  })

  it('leaves the document untouched when there is nothing to insert', () => {
    const before = stateWith()
    const next = apply(before, {
      type: 'insertText',
      at: at(5),
      text: '',
      marks: [],
      timestamp: 0,
    })
    expect(next.doc).toBe(before.doc)
  })

  it('does not mutate the document it was given', () => {
    const before = stateWith()
    const snapshot = JSON.stringify(before.doc)

    apply(before, { type: 'insertText', at: at(5), text: 'XYZ', marks: [], timestamp: 0 })

    expect(JSON.stringify(before.doc)).toBe(snapshot)
  })

  it('shares untouched blocks with the previous document', () => {
    /* What makes a stack of undo snapshots cheap: editing one block leaves
       every other block as the same object. */
    const before = stateWith(doc([paragraph('b1', 'one'), paragraph('b2', 'two')]))
    const next = apply(before, {
      type: 'insertText',
      at: at(0),
      text: 'X',
      marks: [],
      timestamp: 0,
    })

    expect(next.doc.blocks[1]).toBe(before.doc.blocks[1])
    expect(next.doc.blocks[0]).not.toBe(before.doc.blocks[0])
  })

  it('clears pending formatting once it has been consumed', () => {
    const before: EditorState = { ...stateWith(), pendingMarks: [bold] }
    const next = apply(before, {
      type: 'insertText',
      at: at(5),
      text: 'x',
      marks: [bold],
      timestamp: 0,
    })
    expect(next.pendingMarks).toBeNull()
  })

  it('rejects a position pointing at a block that no longer exists', () => {
    expect(() =>
      apply(stateWith(), {
        type: 'insertText',
        at: { blockId: 'gone', offset: 0 },
        text: 'x',
        marks: [],
        timestamp: 0,
      }),
    ).toThrow(/No block with id/)
  })
})
