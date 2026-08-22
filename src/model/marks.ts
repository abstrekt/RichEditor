import type { Mark, MarkType } from './types'

/**
 * Marks are a discriminated union held in an array, which buys exhaustiveness
 * checking everywhere marks are handled — but costs an ordering problem, since
 * [bold, italic] and [italic, bold] describe the same formatting while being
 * different arrays.
 *
 * The fix is to canonicalize once, inside normalization, rather than to compare
 * cleverly. Every mark array in a normalized document is already sorted and
 * deduped, so equality stays a positional walk.
 */

const MARK_ORDER: readonly MarkType[] = ['bold', 'italic', 'link']

function rank(type: MarkType): number {
  const i = MARK_ORDER.indexOf(type)
  /* istanbul ignore next -- unreachable while MarkType and MARK_ORDER agree */
  return i === -1 ? MARK_ORDER.length : i
}

/** Compares two marks for identity, including a link's target. */
export function markEquals(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'link' && b.type === 'link') return a.href === b.href
  return true
}

export function hasMark(marks: readonly Mark[], type: MarkType): boolean {
  return marks.some((m) => m.type === type)
}

export function findMark(marks: readonly Mark[], type: MarkType): Mark | undefined {
  return marks.find((m) => m.type === type)
}

/**
 * Sorts by type, dedupes, and enforces at most one link.
 *
 * The link rule is not automatic: two link marks with different hrefs are not
 * equal, so plain deduplication would leave both, and rendering has no answer
 * for which anchor wraps the text. Last one wins, matching "applying a link to
 * a range replaces whatever was there".
 */
export function canonicalizeMarks(marks: readonly Mark[]): readonly Mark[] {
  if (marks.length === 0) return EMPTY_MARKS
  // One mark is trivially sorted, deduped, and within the one-link limit.
  if (marks.length === 1) return marks

  const seen: Mark[] = []
  for (const mark of marks) {
    if (mark.type === 'link') {
      const existing = seen.findIndex((m) => m.type === 'link')
      if (existing !== -1) {
        seen[existing] = mark
        continue
      }
    } else if (seen.some((m) => markEquals(m, mark))) {
      continue
    }
    seen.push(mark)
  }

  seen.sort((a, b) => rank(a.type) - rank(b.type))

  /* Returning the input when it was already canonical is what lets an unchanged
     span survive normalization by reference. Snapshot history leans on that: an
     edited document shares objects with its predecessor for everything that did
     not change, so a stack of snapshots costs one new block rather than one new
     document. */
  return marksEqual(seen, marks) ? marks : seen
}

/**
 * Valid only on canonical input, which is why canonicalization is an invariant
 * of the normalized document rather than a step inside this function — it runs
 * once per operation instead of once per comparison.
 */
export function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (!left || !right || !markEquals(left, right)) return false
  }
  return true
}

/** Adds a mark, replacing any existing mark of the same type. */
export function withMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  return canonicalizeMarks([...marks.filter((m) => m.type !== mark.type), mark])
}

export function withoutMark(marks: readonly Mark[], type: MarkType): readonly Mark[] {
  const next = marks.filter((m) => m.type !== type)
  return next.length === marks.length ? marks : canonicalizeMarks(next)
}

/** Shared empty array, so unmarked spans compare identical by reference. */
export const EMPTY_MARKS: readonly Mark[] = Object.freeze([])
