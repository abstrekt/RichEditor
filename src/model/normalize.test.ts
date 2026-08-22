import { describe, expect, it } from 'vitest'
import { normalizeBlock, normalizeDoc, normalizeSpans } from './normalize'
import type { Block, Doc, Mark, TextSpan } from './types'

const bold: Mark = { type: 'bold' }
const italic: Mark = { type: 'italic' }

/* Built as raw literals rather than through the construction helpers, because
   those normalize on the way in and there would be nothing left to test. */
const raw = (text: string, marks: readonly Mark[] = []): TextSpan => ({ text, marks })
const rawBlock = (id: string, spans: readonly TextSpan[]): Block => ({
  id,
  type: 'paragraph',
  spans,
})

describe('normalizeSpans', () => {
  it('merges adjacent spans carrying the same marks', () => {
    expect(normalizeSpans([raw('he', [bold]), raw('llo', [bold])])).toEqual([raw('hello', [bold])])
  })

  it('merges across differently ordered but equivalent mark arrays', () => {
    const result = normalizeSpans([raw('he', [bold, italic]), raw('llo', [italic, bold])])
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe('hello')
  })

  it('leaves differently marked neighbours alone', () => {
    const spans = [raw('Hello '), raw('world', [bold])]
    expect(normalizeSpans(spans)).toHaveLength(2)
  })

  it('drops empty spans', () => {
    expect(normalizeSpans([raw('a'), raw(''), raw('b')])).toEqual([raw('ab')])
  })

  it('keeps one empty span when a block has lost all its text', () => {
    /* The alternative — an empty spans array — reads as a tidier invariant and
       forces a "what if there is nothing here" branch into position resolution
       and every insertion path. */
    const result = normalizeSpans([raw('')])
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe('')
  })

  it('carries formatting on a block that has been emptied', () => {
    /* Delete every character of a bold paragraph and keep typing: the text
       should still come out bold. The surviving empty span is where that
       intent lives. */
    const result = normalizeSpans([raw('', [bold])])
    expect(result[0]?.marks).toEqual([bold])
  })

  it('canonicalises mark order inside each span', () => {
    const result = normalizeSpans([raw('x', [italic, bold])])
    expect(result[0]?.marks).toEqual([bold, italic])
  })

  it('is idempotent', () => {
    const once = normalizeSpans([raw('he', [bold]), raw(''), raw('llo', [bold]), raw('!')])
    expect(normalizeSpans(once)).toEqual(once)
  })
})

describe('normalizeBlock', () => {
  it('returns the same object when nothing changes', () => {
    /* Structural sharing is what keeps snapshot history cheap: an unchanged
       block must survive normalization by reference, not by value. */
    const block = normalizeBlock(rawBlock('b1', [raw('hello')]))
    expect(normalizeBlock(block)).toBe(block)
  })

  it('preserves formatted blocks by reference too', () => {
    /* The unformatted case passes for an uninteresting reason — an empty marks
       array normalizes to a shared constant. A block carrying real marks is
       the case that actually exercises canonicalisation returning its input. */
    const block = normalizeBlock(rawBlock('b1', [raw('hello', [bold, italic])]))
    expect(normalizeBlock(block)).toBe(block)
  })

  it('preserves an emptied block by reference', () => {
    const block = normalizeBlock(rawBlock('b1', [raw('')]))
    expect(normalizeBlock(block)).toBe(block)
  })
})

describe('normalizeDoc', () => {
  it('makes identical-looking documents compare deep-equal', () => {
    /* The property the entire test suite rests on. Bolding "hello" in one go
       and bolding "he" then "llo" separately produce different span structures
       and the same document. Without this, every assertion of the form "after
       doing X the document should equal Y" fails on documents that are
       indistinguishable on screen. */
    const typedThenBolded = normalizeDoc({ blocks: [rawBlock('b1', [raw('hello', [bold])])] })
    const boldedInTwoParts = normalizeDoc({
      blocks: [rawBlock('b1', [raw('he', [bold]), raw('llo', [bold])])],
    })

    expect(boldedInTwoParts).toEqual(typedThenBolded)
  })

  it('preserves unchanged blocks by reference', () => {
    const document: Doc = normalizeDoc({
      blocks: [rawBlock('b1', [raw('one')]), rawBlock('b2', [raw('two')])],
    })
    expect(normalizeDoc(document)).toBe(document)
  })

  it('is idempotent', () => {
    const once = normalizeDoc({
      blocks: [rawBlock('b1', [raw('a', [bold]), raw('b', [bold]), raw('')])],
    })
    expect(normalizeDoc(once)).toEqual(once)
  })

  it('refuses a document with no blocks rather than inventing one', () => {
    /* Repairing this would mean fabricating a block id, putting a source of
       arbitrary values in the middle of the model layer to handle a state
       nothing can legitimately produce. */
    expect(() => normalizeDoc({ blocks: [] })).toThrow(/at least one block/)
  })
})
