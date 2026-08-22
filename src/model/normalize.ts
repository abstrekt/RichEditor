import { canonicalizeMarks, EMPTY_MARKS, marksEqual } from './marks'
import type { Block, Doc, TextSpan } from './types'

/**
 * Normalization is what makes "the same document" and "deep-equal object" mean
 * the same thing.
 *
 * Cutting text at formatting boundaries means one visible document can be
 * stored many ways: bold "hello" is a single span if you typed it and bolded
 * it, or two spans if you bolded "he" and "llo" separately. Both render
 * identically. Without a canonical form, every test of the shape "after doing X
 * the document should equal Y" fails on documents that are indistinguishable on
 * screen — and the only remaining way to compare would be rendered output,
 * which is exactly the DOM-snapshot testing the brief rules out.
 *
 * So this runs after every operation, and a lot of code depends on its
 * guarantees without saying so.
 *
 * After normalization:
 *
 *   1. No span has empty text, unless it is the only span in its block
 *   2. No two adjacent spans have equal marks
 *   3. Marks are sorted by type and contain no duplicates
 *   4. At most one link mark per span
 *   5. Every block has at least one span
 *   6. The document has at least one block
 *
 * Rule 1's exception is load-bearing. It exists so rule 5 can hold without
 * exception, which is what keeps position resolution and every insertion path
 * free of "but what if there is nothing here" branches. The alternative —
 * letting an empty block hold zero spans — reads as a tidier invariant and
 * pushes that branch out into every consumer instead.
 *
 * Idempotent: normalizing an already-normalized document returns an equal one.
 */

export const EMPTY_SPAN: TextSpan = Object.freeze({ text: '', marks: EMPTY_MARKS })

export function normalizeSpans(spans: readonly TextSpan[]): readonly TextSpan[] {
  const result: TextSpan[] = []
  let changed = false

  for (const span of spans) {
    if (span.text.length === 0) {
      changed = true
      continue
    }

    const marks = canonicalizeMarks(span.marks)
    const previous = result[result.length - 1]

    if (previous && marksEqual(previous.marks, marks)) {
      result[result.length - 1] = { text: previous.text + span.text, marks: previous.marks }
      changed = true
      continue
    }

    if (marks === span.marks) {
      result.push(span)
    } else {
      result.push({ text: span.text, marks })
      changed = true
    }
  }

  if (result.length > 0) {
    /* Returning the input unchanged is not an optimisation detail — it is what
       gives snapshot history structural sharing. */
    return changed ? result : spans
  }

  /*
   * Every span was empty. Rule 1's exception and rule 5: the block keeps one
   * empty span rather than becoming spans: [], and the marks slot on that span
   * is where formatting survives when a whole bold paragraph is deleted and
   * the user keeps typing.
   */
  const sole = spans.length === 1 ? spans[0] : undefined
  if (sole && sole.text === '' && canonicalizeMarks(sole.marks) === sole.marks) {
    return spans
  }

  const carried = spans.find((s) => s.marks.length > 0)
  return [carried ? { text: '', marks: canonicalizeMarks(carried.marks) } : EMPTY_SPAN]
}

export function normalizeBlock(block: Block): Block {
  const spans = normalizeSpans(block.spans)
  return spans === block.spans ? block : { ...block, spans }
}

export function normalizeDoc(doc: Doc): Doc {
  /*
   * Rule 6, asserted rather than repaired.
   *
   * Repairing it would mean inventing a block, and inventing a block means
   * inventing an ID — but IDs are supplied by the caller precisely so that
   * operations stay pure and testable. Fabricating one here would put a source
   * of arbitrary values in the middle of the model layer to handle a state
   * nothing can legitimately produce: documents are created through
   * createEmptyDoc, deserialization rejects a zero-block document as malformed,
   * and no operation can remove the last block.
   *
   * So reaching this is a bug upstream, and failing loudly beats papering over
   * it with a made-up identifier.
   */
  if (doc.blocks.length === 0) {
    throw new Error(
      'Document has no blocks. Documents always hold at least one block — ' +
        'use createEmptyDoc() to construct one.',
    )
  }

  const blocks = doc.blocks.map(normalizeBlock)
  const unchanged = blocks.every((block, i) => block === doc.blocks[i])
  return unchanged ? doc : { blocks }
}
