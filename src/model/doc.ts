import { canonicalizeMarks } from './marks'
import { EMPTY_SPAN, normalizeDoc } from './normalize'
import type { Block, Doc, Mark, TextSpan } from './types'

/**
 * Construction helpers.
 *
 * Every one of these takes its block IDs as arguments rather than generating
 * them. IDs are a source of non-determinism, and keeping them out of the model
 * layer is what lets a test assert `expect(result).toEqual(expected)` on whole
 * documents instead of stripping unpredictable fields first.
 */

export function span(text: string, marks: readonly Mark[] = []): TextSpan {
  return { text, marks: canonicalizeMarks(marks) }
}

export function block(id: string, spans: readonly TextSpan[]): Block {
  return { id, type: 'paragraph', spans: spans.length > 0 ? spans : [EMPTY_SPAN] }
}

/** A block holding a single run of text — the common case in tests. */
export function paragraph(id: string, text: string, marks: readonly Mark[] = []): Block {
  return block(id, text.length > 0 ? [span(text, marks)] : [EMPTY_SPAN])
}

export function doc(blocks: readonly Block[]): Doc {
  return normalizeDoc({ blocks })
}

/** A new document: one empty paragraph, since a document always holds a block. */
export function createEmptyDoc(blockId: string): Doc {
  return { blocks: [{ id: blockId, type: 'paragraph', spans: [EMPTY_SPAN] }] }
}
