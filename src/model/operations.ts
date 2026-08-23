import { canonicalizeMarks } from './marks'
import {
  nextGraphemeBoundary,
  nextWordBoundary,
  previousGraphemeBoundary,
  previousWordBoundary,
} from './segment'
import {
  blockIndex,
  blockLength,
  blockText,
  collapsedAt,
  findBlock,
  isCollapsed,
  orderRange,
  resolvePosition,
  splitSpan,
} from './selection'
import type { Block, Doc, Mark, MarkType, Selection, TextSpan } from './types'

/**
 * Raw operations. Each changes the document and stops.
 *
 * None of them normalize, place the final selection, or touch history — those
 * happen exactly once per user action, in `apply`. So these routinely return
 * documents holding empty spans or adjacent spans with identical marks. That is
 * expected, not a bug, and it is why nothing here is exported from the model's
 * public surface.
 *
 * Every operation takes a **selection**, not a position. A collapsed selection
 * is not a special case — it is the degenerate one. That means "type over the
 * selected word" is a single operation rather than a delete composed with an
 * insert, so it normalizes once and takes one press of Ctrl+Z to reverse.
 */

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOperationError'
  }
}

/** What a delete consumes when the selection is collapsed. */
export type DeleteUnit = 'character' | 'word' | 'lineStart'

/**
 * Operations report where the caret ends up, because only they know.
 *
 * They also report formatting intent. Toggling a mark with a collapsed caret
 * changes no text at all — there is nothing to format yet — so the entire
 * result of that operation is an intention to be applied to whatever gets typed
 * next. Returning it here keeps that on the same path as every other change
 * rather than needing a second mechanism.
 */
export interface OperationResult {
  readonly doc: Doc
  readonly selection: Selection
  readonly pendingMarks: readonly Mark[] | null
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

function withBlocks(blocks: readonly Block[]): Doc {
  return { blocks }
}

/** Spans covering everything before `offset`. The last one may be empty;
 *  normalization drops it rather than every caller checking. */
function spansBefore(block: Block, offset: number): readonly TextSpan[] {
  const { spanIndex, offsetInSpan } = resolvePosition(block, offset)
  const target = block.spans[spanIndex]
  if (!target) return block.spans.slice(0, spanIndex)
  const [before] = splitSpan(target, offsetInSpan)
  return [...block.spans.slice(0, spanIndex), before]
}

/** Spans covering everything from `offset` onward. */
function spansAfter(block: Block, offset: number): readonly TextSpan[] {
  const { spanIndex, offsetInSpan } = resolvePosition(block, offset)
  const target = block.spans[spanIndex]
  if (!target) return block.spans.slice(spanIndex + 1)
  const [, after] = splitSpan(target, offsetInSpan)
  return [after, ...block.spans.slice(spanIndex + 1)]
}

/**
 * Removes everything between the two ends of a range.
 *
 * Across blocks, the first block survives and absorbs the tail of the last —
 * matching the rule that a split leaves the original id on the earlier half.
 * Everything strictly between them disappears.
 */
export function deleteRangeRaw(document: Doc, selection: Selection): OperationResult {
  const { start, end } = orderRange(document, selection)

  if (start.blockId === end.blockId) {
    const block = requireBlock(document, start.blockId)
    const spans = [...spansBefore(block, start.offset), ...spansAfter(block, end.offset)]

    return {
      doc: withBlocks(
        document.blocks.map((b) => (b.id === block.id ? { ...b, spans } : b)),
      ),
      selection: collapsedAt(start),
      pendingMarks: null,
    }
  }

  const firstBlock = requireBlock(document, start.blockId)
  const lastBlock = requireBlock(document, end.blockId)
  const firstIndex = blockIndex(document, start.blockId)
  const lastIndex = blockIndex(document, end.blockId)

  const merged: Block = {
    ...firstBlock,
    spans: [...spansBefore(firstBlock, start.offset), ...spansAfter(lastBlock, end.offset)],
  }

  return {
    doc: withBlocks([
      ...document.blocks.slice(0, firstIndex),
      merged,
      ...document.blocks.slice(lastIndex + 1),
    ]),
    selection: collapsedAt(start),
    pendingMarks: null,
  }
}

export function insertTextRaw(
  document: Doc,
  selection: Selection,
  text: string,
  marks: readonly Mark[],
): OperationResult {
  /* A range under the caret is replaced, which is what typing with text
     selected means everywhere else. Doing it here rather than as a separate
     composed operation is what keeps it one normalization and one undo step. */
  const cleared: OperationResult = isCollapsed(selection)
    ? { doc: document, selection, pendingMarks: null }
    : deleteRangeRaw(document, selection)

  const at = cleared.selection.anchor
  if (text.length === 0) return cleared

  const block = requireBlock(cleared.doc, at.blockId)
  const { spanIndex, offsetInSpan } = resolvePosition(block, at.offset)
  const target = block.spans[spanIndex]

  if (!target) {
    throw new InvalidOperationError(
      `Position ${at.offset} did not resolve to a span in block "${at.blockId}".`,
    )
  }

  const [before, after] = splitSpan(target, offsetInSpan)
  const spans = [
    ...block.spans.slice(0, spanIndex),
    before,
    { text, marks },
    after,
    ...block.spans.slice(spanIndex + 1),
  ]

  return {
    doc: withBlocks(
      cleared.doc.blocks.map((b) => (b.id === block.id ? { ...b, spans } : b)),
    ),
    selection: collapsedAt({ blockId: block.id, offset: at.offset + text.length }),
    pendingMarks: null,
  }
}

/**
 * Backspace.
 *
 * With a range selected, the range goes and the unit is ignored — that is what
 * every editor does, and it is why the unit is only consulted for a caret.
 *
 * At the very start of a block the caret has nothing behind it to delete, so
 * this merges the block into the one above instead. In the first block of the
 * document there is no block above, and nothing happens: silently doing nothing
 * beats inventing a behaviour.
 */
export function deleteBackwardRaw(
  document: Doc,
  selection: Selection,
  unit: DeleteUnit,
): OperationResult {
  if (!isCollapsed(selection)) return deleteRangeRaw(document, selection)

  const at = selection.focus
  const block = requireBlock(document, at.blockId)

  if (at.offset === 0) return mergeWithPreviousRaw(document, block)

  const text = blockText(block)
  const from = backwardTarget(text, at.offset, unit)

  return deleteRangeRaw(document, {
    anchor: { blockId: block.id, offset: from },
    focus: at,
  })
}

function backwardTarget(text: string, offset: number, unit: DeleteUnit): number {
  switch (unit) {
    case 'character':
      /* A grapheme cluster, not a code unit. Removing one code unit from an
         emoji sequence splits a surrogate pair; removing one code point turns
         a four-person family emoji into a three-person one. */
      return previousGraphemeBoundary(text, offset)

    case 'word':
      return previousWordBoundary(text, offset)

    case 'lineStart':
      return 0
  }
}

export function deleteForwardRaw(
  document: Doc,
  selection: Selection,
  unit: DeleteUnit,
): OperationResult {
  if (!isCollapsed(selection)) return deleteRangeRaw(document, selection)

  const at = selection.focus
  const block = requireBlock(document, at.blockId)
  const length = blockLength(block)

  /* At the end of a block, pull the next block up — the mirror of backspace at
     the start pushing this one into the previous. */
  if (at.offset >= length) {
    const index = blockIndex(document, block.id)
    const next = document.blocks[index + 1]
    if (!next) return { doc: document, selection, pendingMarks: null }

    return {
      doc: withBlocks([
        ...document.blocks.slice(0, index),
        { ...block, spans: [...block.spans, ...next.spans] },
        ...document.blocks.slice(index + 2),
      ]),
      selection: collapsedAt(at),
      pendingMarks: null,
    }
  }

  const text = blockText(block)
  const to =
    unit === 'word' ? nextWordBoundary(text, at.offset) : nextGraphemeBoundary(text, at.offset)

  return deleteRangeRaw(document, { anchor: at, focus: { blockId: block.id, offset: to } })
}

function mergeWithPreviousRaw(document: Doc, block: Block): OperationResult {
  const index = blockIndex(document, block.id)
  const previous = document.blocks[index - 1]

  if (!previous) {
    /* First block of the document — nothing above to merge into. */
    return {
      doc: document,
      selection: collapsedAt({ blockId: block.id, offset: 0 }),
      pendingMarks: null,
    }
  }

  const joinAt = blockLength(previous)

  return {
    doc: withBlocks([
      ...document.blocks.slice(0, index - 1),
      { ...previous, spans: [...previous.spans, ...block.spans] },
      ...document.blocks.slice(index + 1),
    ]),
    selection: collapsedAt({ blockId: previous.id, offset: joinAt }),
    pendingMarks: null,
  }
}

/**
 * Enter.
 *
 * The original id stays with the first half, so the existing DOM element is
 * reused for the text the caret is leaving and only the new block is created.
 * Giving the id to the second half would destroy and recreate both.
 *
 * The new block inherits its formatting from the split point through the same
 * rule that governs typing, so pressing Enter at the end of a bold line and
 * carrying on keeps you in bold.
 */
export function splitBlockRaw(
  document: Doc,
  selection: Selection,
  newBlockId: string,
): OperationResult {
  const cleared: OperationResult = isCollapsed(selection)
    ? { doc: document, selection, pendingMarks: null }
    : deleteRangeRaw(document, selection)

  const at = cleared.selection.anchor
  const block = requireBlock(cleared.doc, at.blockId)
  const index = blockIndex(cleared.doc, block.id)

  const head: Block = { ...block, spans: spansBefore(block, at.offset) }
  const tail: Block = { id: newBlockId, type: 'paragraph', spans: spansAfter(block, at.offset) }

  return {
    doc: withBlocks([
      ...cleared.doc.blocks.slice(0, index),
      head,
      tail,
      ...cleared.doc.blocks.slice(index + 1),
    ]),
    selection: collapsedAt({ blockId: newBlockId, offset: 0 }),
    pendingMarks: null,
  }
}

/**
 * Applies or removes a mark across a selection.
 *
 * The rule for a partly-formatted range: **remove it only when every character
 * already carries it; otherwise add it to all of them.** Pressing a format
 * button is a statement of intent to apply, and only when applying would be a
 * no-op does pressing it plausibly mean "take this away". Inverting each
 * character independently is internally consistent and useless — half the
 * selection would lose its formatting on a keystroke meant to add it.
 *
 * With a collapsed caret there is nothing to format yet, so the operation
 * changes no text and records intent instead. That intent is a complete mark
 * set rather than a list of marks to add, because pressing Ctrl+B just after a
 * bold word has to be able to mean *not* bold — contradicting the formatting
 * that would otherwise be inherited.
 */
export function toggleMarkRaw(
  document: Doc,
  selection: Selection,
  mark: Mark,
  remove: boolean,
  currentMarks: readonly Mark[],
): OperationResult {
  if (isCollapsed(selection)) {
    return {
      doc: document,
      selection,
      pendingMarks: remove
        ? currentMarks.filter((m) => m.type !== mark.type)
        : canonicalizeMarks([...currentMarks.filter((m) => m.type !== mark.type), mark]),
    }
  }

  const { start, end } = orderRange(document, selection)
  const firstIndex = blockIndex(document, start.blockId)
  const lastIndex = blockIndex(document, end.blockId)

  const blocks = document.blocks.map((block, i) => {
    if (i < firstIndex || i > lastIndex) return block

    const from = i === firstIndex ? start.offset : 0
    const to = i === lastIndex ? end.offset : blockLength(block)

    return {
      ...block,
      spans: [
        ...spansBefore(block, from),
        ...spansBetween(block, from, to).map((span) => ({
          text: span.text,
          marks: remove
            ? span.marks.filter((m) => m.type !== mark.type)
            : canonicalizeMarks([...span.marks.filter((m) => m.type !== mark.type), mark]),
        })),
        ...spansAfter(block, to),
      ],
    }
  })

  return { doc: withBlocks(blocks), selection, pendingMarks: null }
}

/** Spans covering [from, to), clipped to those bounds. */
function spansBetween(block: Block, from: number, to: number): readonly TextSpan[] {
  const result: TextSpan[] = []
  let offset = 0

  for (const span of block.spans) {
    const start = offset
    const end = offset + span.text.length
    offset = end

    if (end <= from || start >= to) continue

    result.push({
      text: span.text.slice(Math.max(from - start, 0), Math.min(to - start, span.text.length)),
      marks: span.marks,
    })
  }

  return result
}


/**
 * Takes a mark off a range, regardless of how much of it currently carries the
 * mark.
 *
 * Distinct from toggling because links are set-or-remove rather than
 * toggleable: applying a different target replaces, so "remove this link" has
 * to be sayable directly rather than inferred from the mark already being
 * there.
 */
export function removeMarkRaw(
  document: Doc,
  selection: Selection,
  markType: MarkType,
): OperationResult {
  const { start, end } = orderRange(document, selection)
  const firstIndex = blockIndex(document, start.blockId)
  const lastIndex = blockIndex(document, end.blockId)

  const blocks = document.blocks.map((block, i) => {
    if (i < firstIndex || i > lastIndex) return block

    const from = i === firstIndex ? start.offset : 0
    const to = i === lastIndex ? end.offset : blockLength(block)

    return {
      ...block,
      spans: [
        ...spansBefore(block, from),
        ...spansBetween(block, from, to).map((span) => ({
          text: span.text,
          marks: span.marks.filter((m) => m.type !== markType),
        })),
        ...spansAfter(block, to),
      ],
    }
  })

  return { doc: withBlocks(blocks), selection, pendingMarks: null }
}
