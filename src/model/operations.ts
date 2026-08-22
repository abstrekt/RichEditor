import { findBlock, resolvePosition, splitSpan } from './selection'
import type { Block, Doc, Mark, Position, TextSpan } from './types'

/**
 * Raw operations. Each one changes the document and stops.
 *
 * None of them normalize, remap the selection, or touch history — those happen
 * exactly once per user action, in `apply`. So these return documents that may
 * hold empty spans or adjacent spans with identical marks, and that is expected
 * rather than a bug.
 *
 * Nothing here is exported from the model's public surface, precisely because
 * the intermediate documents they produce are not canonical.
 */

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOperationError'
  }
}

function requireBlock(document: Doc, blockId: string): Block {
  const block = findBlock(document, blockId)
  if (!block) {
    throw new InvalidOperationError(
      `No block with id "${blockId}". Positions address blocks by id, so this ` +
        'means a stale position outlived the block it pointed at.',
    )
  }
  return block
}

function replaceBlock(document: Doc, blockId: string, next: Block): Doc {
  return { blocks: document.blocks.map((b) => (b.id === blockId ? next : b)) }
}

/**
 * Inserts text at a position.
 *
 * `marks` is what the inserted run should carry. The caller decides that —
 * explicit pending marks if the user toggled formatting, otherwise inherited
 * from the character to the left — because that is a question about intent,
 * not about text manipulation.
 *
 * Splitting the target span always produces two halves and one of them is
 * frequently empty. Rather than branch on that here, the empty half is left for
 * normalization to drop, which keeps the shape of this function the same in
 * every case.
 */
export function insertTextRaw(
  document: Doc,
  at: Position,
  text: string,
  marks: readonly Mark[],
): Doc {
  if (text.length === 0) return document

  const block = requireBlock(document, at.blockId)
  const { spanIndex, offsetInSpan } = resolvePosition(block, at.offset)
  const target = block.spans[spanIndex]

  if (!target) {
    throw new InvalidOperationError(
      `Position ${at.offset} did not resolve to a span in block "${at.blockId}".`,
    )
  }

  const [before, after] = splitSpan(target, offsetInSpan)
  const inserted: TextSpan = { text, marks }

  const spans = [
    ...block.spans.slice(0, spanIndex),
    before,
    inserted,
    after,
    ...block.spans.slice(spanIndex + 1),
  ]

  return replaceBlock(document, block.id, { ...block, spans })
}
