import { describe, expect, it } from 'vitest'
import {
  canonicalizeMarks,
  hasMark,
  markEquals,
  marksEqual,
  withMark,
  withoutMark,
} from './marks'
import type { Mark } from './types'

const bold: Mark = { type: 'bold' }
const italic: Mark = { type: 'italic' }
const link = (href: string): Mark => ({ type: 'link', href })

describe('canonicalizeMarks', () => {
  it('orders marks so that equal formatting produces equal arrays', () => {
    /* This is the whole point. [bold, italic] and [italic, bold] describe the
       same formatting, and normalization has to be able to merge two spans
       carrying them. */
    expect(canonicalizeMarks([italic, bold])).toEqual(canonicalizeMarks([bold, italic]))
  })

  it('removes duplicates', () => {
    expect(canonicalizeMarks([bold, bold])).toEqual([bold])
  })

  it('keeps only the last link when several are present', () => {
    /* Not covered by deduplication: two links with different hrefs are not
       equal, so both would survive — and rendering has no answer for which
       anchor wraps the text. */
    expect(canonicalizeMarks([link('a.com'), link('b.com')])).toEqual([link('b.com')])
  })

  it('keeps a link alongside other marks', () => {
    const result = canonicalizeMarks([link('a.com'), bold])
    expect(result).toHaveLength(2)
    expect(result).toContainEqual(bold)
    expect(result).toContainEqual(link('a.com'))
  })

  it('is idempotent', () => {
    const once = canonicalizeMarks([italic, bold, link('a.com'), bold])
    expect(canonicalizeMarks(once)).toEqual(once)
  })

  it('returns already-canonical input by reference', () => {
    /* Not a micro-optimisation. Snapshot history is only cheap because an
       unchanged span survives normalization as the same object — if this
       allocated a fresh array every pass, every span in the document would
       look modified after every keystroke and the whole document would be
       rebuilt into each history entry. */
    const canonical = canonicalizeMarks([italic, bold])
    expect(canonicalizeMarks(canonical)).toBe(canonical)
  })
})

describe('markEquals', () => {
  it('distinguishes links by target', () => {
    expect(markEquals(link('a.com'), link('b.com'))).toBe(false)
    expect(markEquals(link('a.com'), link('a.com'))).toBe(true)
  })

  it('ignores nothing else — bold is bold', () => {
    expect(markEquals(bold, bold)).toBe(true)
    expect(markEquals(bold, italic)).toBe(false)
  })
})

describe('marksEqual', () => {
  it('compares canonical arrays positionally', () => {
    expect(marksEqual(canonicalizeMarks([bold, italic]), canonicalizeMarks([italic, bold]))).toBe(
      true,
    )
  })

  it('separates spans that differ only in link target', () => {
    expect(marksEqual([link('a.com')], [link('b.com')])).toBe(false)
  })

  it('treats empty as equal to empty', () => {
    expect(marksEqual([], [])).toBe(true)
  })

  it('rejects different lengths', () => {
    expect(marksEqual([bold], [bold, italic])).toBe(false)
  })
})

describe('withMark and withoutMark', () => {
  it('replaces a mark of the same type rather than adding a second', () => {
    expect(withMark([link('a.com')], link('b.com'))).toEqual([link('b.com')])
  })

  it('adds a mark that is not present', () => {
    expect(hasMark(withMark([bold], italic), 'italic')).toBe(true)
  })

  it('returns the same array when removing a mark that is absent', () => {
    const marks = canonicalizeMarks([bold])
    expect(withoutMark(marks, 'italic')).toBe(marks)
  })

  it('removes a mark that is present', () => {
    expect(withoutMark(canonicalizeMarks([bold, italic]), 'bold')).toEqual([italic])
  })
})
