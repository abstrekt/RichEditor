import { describe, expect, it } from 'vitest'

/**
 * There is no product code to test yet. What there is are two structural
 * guarantees the rest of the build leans on, and both are worth asserting
 * rather than assuming.
 */
describe('test environment', () => {
  /**
   * The brief asks for "logic tests, not DOM snapshots". Running the suite in
   * a node environment turns that from an intention into an invariant: any
   * import of a browser API under src/model/ fails here immediately, rather
   * than passing quietly under jsdom and letting DOM coupling creep into the
   * layer that is supposed to be pure.
   */
  it('has no DOM, so model code cannot quietly depend on one', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })

  /**
   * Positions in the model count UTF-16 code units, but every operation that
   * moves or deletes works in whole grapheme clusters. That relies on
   * Intl.Segmenter being present with full ICU data — without it, deleting one
   * "character" from a zero-width-joiner emoji sequence silently mutates it
   * into a different valid emoji rather than removing it.
   */
  it('has Intl.Segmenter with full ICU data', () => {
    expect(typeof Intl.Segmenter).toBe('function')

    const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'

    // Eleven code units, seven code points, one thing a human can see.
    expect(family.length).toBe(11)
    expect([...family].length).toBe(7)
    expect([...graphemes.segment(family)].length).toBe(1)
  })

  /**
   * Word boundaries are locale-dependent. Scanning back to the previous space
   * works for English and deletes an entire sentence in Japanese, which has no
   * spaces between words — so word-wise deletion goes through Intl.Segmenter
   * rather than a hand-rolled whitespace scan.
   */
  it('segments words in a script that does not use spaces', () => {
    const words = new Intl.Segmenter(undefined, { granularity: 'word' })
    const japanese = '日本語を勉強します'

    const wordLike = [...words.segment(japanese)].filter((s) => s.isWordLike)
    expect(wordLike.length).toBeGreaterThan(1)
  })
})
