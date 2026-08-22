import { describe, expect, it } from 'vitest'
import {
  nextGraphemeBoundary,
  nextWordBoundary,
  previousGraphemeBoundary,
  previousWordBoundary,
} from './segment'

/* Four person emoji joined by zero-width joiners: 11 code units, 7 code
   points, one thing a human sees. */
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'

/* "e" followed by a combining acute accent — renders as é, but is two code
   points, and deleting one leaves a bare accent on the previous letter. */
const COMBINING_E = 'é'

describe('previousGraphemeBoundary', () => {
  it('steps back one code unit through plain text', () => {
    expect(previousGraphemeBoundary('hello', 5)).toBe(4)
  })

  it('steps over an entire emoji sequence rather than into it', () => {
    /* Stepping back by one code point would land at 9, leaving a
       three-person family. Backspace pressed once should remove the emoji. */
    expect(FAMILY.length).toBe(11)
    expect(previousGraphemeBoundary(FAMILY, FAMILY.length)).toBe(0)
  })

  it('steps over a combining accent with the letter it modifies', () => {
    expect(previousGraphemeBoundary(COMBINING_E, COMBINING_E.length)).toBe(0)
  })

  it('stops at the start of the text', () => {
    expect(previousGraphemeBoundary('hello', 0)).toBe(0)
  })
})

describe('nextGraphemeBoundary', () => {
  it('steps forward one code unit through plain text', () => {
    expect(nextGraphemeBoundary('hello', 0)).toBe(1)
  })

  it('steps over an entire emoji sequence', () => {
    expect(nextGraphemeBoundary(FAMILY, 0)).toBe(FAMILY.length)
  })

  it('stops at the end of the text', () => {
    expect(nextGraphemeBoundary('hello', 5)).toBe(5)
  })
})

describe('previousWordBoundary', () => {
  it('finds the start of the preceding word', () => {
    expect(previousWordBoundary('hello world', 11)).toBe(6)
  })

  it('consumes trailing whitespace along with the word', () => {
    /* Otherwise deleting backwards from "hello world " stops on the space and
       needs a second press to remove anything visible. */
    expect(previousWordBoundary('hello world ', 12)).toBe(6)
  })

  it('handles a script with no spaces between words', () => {
    /* A scan back to the previous space finds nothing here and deletes the
       whole sentence. Intl.Segmenter knows where the words are. */
    const japanese = '日本語を勉強します'
    const boundary = previousWordBoundary(japanese, japanese.length)
    expect(boundary).toBeGreaterThan(0)
    expect(boundary).toBeLessThan(japanese.length)
  })

  it('consumes a run of pure punctuation', () => {
    expect(previousWordBoundary('...', 3)).toBe(0)
  })

  it('stops at the start of the text', () => {
    expect(previousWordBoundary('hello', 0)).toBe(0)
  })
})

describe('nextWordBoundary', () => {
  it('finds the end of the following word', () => {
    expect(nextWordBoundary('hello world', 0)).toBe(5)
  })

  it('skips leading whitespace to reach the next word', () => {
    expect(nextWordBoundary('hello world', 5)).toBe(11)
  })

  it('stops at the end of the text', () => {
    expect(nextWordBoundary('hello', 5)).toBe(5)
  })
})
