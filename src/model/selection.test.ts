import { describe, expect, it } from 'vitest'
import { block, doc, paragraph, span } from './doc'
import {
  blockLength,
  blockText,
  clampOffset,
  collapsedAt,
  flattenOffset,
  isCollapsed,
  orderRange,
  resolvePosition,
  splitSpan,
} from './selection'
import type { Mark } from './types'

const bold: Mark = { type: 'bold' }

/*  "Hello world" with "world" bold — offsets 0-6 in the first span, 6-11 in
 *  the second, so offset 6 sits exactly on the boundary.
 *
 *      H  e  l  l  o     w  o  r  l  d
 *     0  1  2  3  4  5  6  7  8  9 10 11
 *                        |____bold____|
 */
const mixed = block('b1', [span('Hello '), span('world', [bold])])

describe('blockText and blockLength', () => {
  it('flattens spans into one string', () => {
    expect(blockText(mixed)).toBe('Hello world')
  })

  it('counts UTF-16 code units, matching String.length and DOM offsets', () => {
    expect(blockLength(mixed)).toBe('Hello world'.length)
  })

  it('reports an emptied block as zero-length with one span', () => {
    const empty = paragraph('b1', '')
    expect(blockText(empty)).toBe('')
    expect(blockLength(empty)).toBe(0)
    expect(empty.spans).toHaveLength(1)
  })
})

describe('resolvePosition', () => {
  it('finds an offset inside the first span', () => {
    expect(resolvePosition(mixed, 3)).toEqual({ spanIndex: 0, offsetInSpan: 3 })
  })

  it('finds an offset inside a later span, discounting the ones before it', () => {
    expect(resolvePosition(mixed, 8)).toEqual({ spanIndex: 1, offsetInSpan: 2 })
  })

  it('resolves a boundary offset to the end of the earlier span', () => {
    /* Offset 6 is both the end of "Hello " and the start of "world". Resolving
       backwards matches the affinity rule, so a position and the formatting it
       inherits never disagree about which side of a boundary they are on. */
    expect(resolvePosition(mixed, 6)).toEqual({ spanIndex: 0, offsetInSpan: 6 })
  })

  it('resolves the end of the block', () => {
    expect(resolvePosition(mixed, 11)).toEqual({ spanIndex: 1, offsetInSpan: 5 })
  })

  it('always resolves to a real span, even in an empty block', () => {
    /* No null check needed anywhere downstream: a block always holds at least
       one span, which is the entire reason an emptied block keeps one. */
    expect(resolvePosition(paragraph('b1', ''), 0)).toEqual({ spanIndex: 0, offsetInSpan: 0 })
  })

  it('clamps offsets outside the block', () => {
    expect(resolvePosition(mixed, 999)).toEqual({ spanIndex: 1, offsetInSpan: 5 })
    expect(resolvePosition(mixed, -5)).toEqual({ spanIndex: 0, offsetInSpan: 0 })
  })
})

describe('flattenOffset', () => {
  it('inverts resolvePosition', () => {
    for (let offset = 0; offset <= blockLength(mixed); offset++) {
      expect(flattenOffset(mixed, resolvePosition(mixed, offset))).toBe(offset)
    }
  })
})

describe('clampOffset', () => {
  it('bounds an offset to the block', () => {
    expect(clampOffset(mixed, -1)).toBe(0)
    expect(clampOffset(mixed, 99)).toBe(11)
    expect(clampOffset(mixed, 4)).toBe(4)
  })
})

describe('orderRange', () => {
  const document = doc([paragraph('b1', 'first'), paragraph('b2', 'second')])

  it('leaves a forward selection alone', () => {
    const range = orderRange(document, {
      anchor: { blockId: 'b1', offset: 1 },
      focus: { blockId: 'b1', offset: 4 },
    })
    expect(range.start.offset).toBe(1)
    expect(range.end.offset).toBe(4)
  })

  it('sorts a backwards selection within a block', () => {
    /* Selecting right-to-left puts the focus before the anchor. Operations
       don't care about direction, so they order it here — but the selection
       itself keeps anchor and focus, because shift-arrow extends from the
       focus and an ordered pair would lose that. */
    const range = orderRange(document, {
      anchor: { blockId: 'b1', offset: 4 },
      focus: { blockId: 'b1', offset: 1 },
    })
    expect(range.start.offset).toBe(1)
    expect(range.end.offset).toBe(4)
  })

  it('sorts across blocks by document order, not by offset', () => {
    const range = orderRange(document, {
      anchor: { blockId: 'b2', offset: 0 },
      focus: { blockId: 'b1', offset: 3 },
    })
    expect(range.start.blockId).toBe('b1')
    expect(range.end.blockId).toBe('b2')
  })
})

describe('collapsed selections', () => {
  it('recognises a caret', () => {
    expect(isCollapsed(collapsedAt({ blockId: 'b1', offset: 2 }))).toBe(true)
  })

  it('recognises a range', () => {
    expect(
      isCollapsed({ anchor: { blockId: 'b1', offset: 2 }, focus: { blockId: 'b1', offset: 5 } }),
    ).toBe(false)
  })
})

describe('splitSpan', () => {
  it('divides a span, carrying the marks onto both halves', () => {
    const [before, after] = splitSpan(span('world', [bold]), 2)
    expect(before).toEqual({ text: 'wo', marks: [bold] })
    expect(after).toEqual({ text: 'rld', marks: [bold] })
  })

  it('produces an empty half at an edge, leaving normalization to drop it', () => {
    const [before, after] = splitSpan(span('world'), 0)
    expect(before.text).toBe('')
    expect(after.text).toBe('world')
  })
})
