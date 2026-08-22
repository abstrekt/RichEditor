/**
 * Grapheme cluster and word boundaries.
 *
 * Offsets in this model count UTF-16 code units, because that matches both
 * `String.length` and the offsets the DOM reports, so no conversion sits
 * between the model and the browser. But "one character" to a person is not one
 * code unit:
 *
 *   a family emoji is 11 code units, 7 code points, and 1 thing you can see
 *
 * Deleting a code unit from that splits a surrogate pair and produces an
 * invalid string. Deleting a code point produces a *different valid emoji* —
 * press Backspace once and the family loses a member. Only deleting the whole
 * grapheme cluster is right.
 *
 * So the invariant is: a position inside a grapheme cluster is representable,
 * but no operation ever creates one.
 *
 * Word boundaries are locale-dependent in the same way. Scanning back to the
 * previous space works for English and deletes an entire sentence in Japanese
 * or Thai, which do not separate words with spaces. Intl.Segmenter knows the
 * Unicode rules; a hand-rolled scan cannot.
 */

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const words = new Intl.Segmenter(undefined, { granularity: 'word' })

/** Start of the grapheme cluster ending at `offset`, or `offset` if at 0. */
export function previousGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0

  let boundary = 0
  for (const segment of graphemes.segment(text)) {
    if (segment.index >= offset) break
    boundary = segment.index
  }
  return boundary
}

/** End of the grapheme cluster starting at `offset`, or `offset` if at the end. */
export function nextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length

  for (const segment of graphemes.segment(text)) {
    const end = segment.index + segment.segment.length
    if (end > offset) return end
  }
  return text.length
}

/**
 * Start of the word before `offset`.
 *
 * Trailing whitespace and punctuation are consumed along with the word, so
 * deleting backwards from "hello world " lands after "hello" rather than
 * stopping on the space and requiring a second press.
 */
export function previousWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0

  const segments = [...words.segment(text)].filter((s) => s.index < offset)

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment?.isWordLike) return segment.index
  }

  /* Nothing word-like before the caret — the run is entirely whitespace or
     punctuation, so consume all of it. */
  return 0
}

/** End of the word after `offset`. */
export function nextWordBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length

  for (const segment of words.segment(text)) {
    const end = segment.index + segment.segment.length
    if (segment.isWordLike && end > offset) return end
  }
  return text.length
}
