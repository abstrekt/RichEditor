import type { Block, Doc, Position, Selection, TextSpan } from './types'

/**
 * Selection math, as pure functions over plain data.
 *
 * Nothing here takes or returns a DOM type. The adapter that talks to the
 * browser pulls plain values out of nodes and calls in here, which is what
 * makes the interesting half of selection mapping testable without a browser —
 * the brief asks for logic tests rather than DOM snapshots, and this is the
 * seam that delivers it.
 *
 * Offsets count UTF-16 code units, matching both `String.length` and the
 * offsets the DOM hands back, so no conversion layer sits between the model and
 * the browser. Operations that move or delete work in grapheme clusters
 * instead: a position inside a cluster is representable, but no operation
 * creates one.
 */

/** A resolved position: which span an offset falls in, and how far into it. */
export interface SpanPoint {
  readonly spanIndex: number
  readonly offsetInSpan: number
}

/** An ordered pair, for operations that need a range rather than a direction. */
export interface OrderedRange {
  readonly start: Position
  readonly end: Position
}

export function blockText(block: Block): string {
  if (block.spans.length === 1) return block.spans[0]?.text ?? ''
  return block.spans.map((s) => s.text).join('')
}

export function blockLength(block: Block): number {
  let total = 0
  for (const span of block.spans) total += span.text.length
  return total
}

export function findBlock(document: Doc, blockId: string): Block | undefined {
  return document.blocks.find((b) => b.id === blockId)
}

export function blockIndex(document: Doc, blockId: string): number {
  return document.blocks.findIndex((b) => b.id === blockId)
}

/**
 * Turns a block-relative character offset into a span index and an offset
 * within that span.
 *
 * Where an offset falls exactly on a span boundary it resolves to the *end of
 * the earlier span* rather than the start of the later one. That is the same
 * backward bias the affinity rule uses, so a position and the formatting it
 * inherits never disagree about which side of a boundary they are on.
 *
 * Always returns a real span, because a block always holds at least one — even
 * an empty block, which holds a single empty span precisely so this function
 * needs no "but what if there is nothing here" branch.
 */
export function resolvePosition(block: Block, offset: number): SpanPoint {
  const clamped = clampOffset(block, offset)

  let consumed = 0
  for (let i = 0; i < block.spans.length; i++) {
    const span = block.spans[i]
    if (!span) continue

    const end = consumed + span.text.length
    if (clamped <= end) return { spanIndex: i, offsetInSpan: clamped - consumed }
    consumed = end
  }

  /* Unreachable while blockLength agrees with the spans it summed, but the
     compiler can't know that and a silent undefined would be worse. */
  const lastIndex = block.spans.length - 1
  return { spanIndex: lastIndex, offsetInSpan: block.spans[lastIndex]?.text.length ?? 0 }
}

/** The inverse of resolvePosition. */
export function flattenOffset(block: Block, point: SpanPoint): number {
  let total = 0
  for (let i = 0; i < point.spanIndex && i < block.spans.length; i++) {
    total += block.spans[i]?.text.length ?? 0
  }
  return total + point.offsetInSpan
}

export function clampOffset(block: Block, offset: number): number {
  const max = blockLength(block)
  if (offset < 0) return 0
  return offset > max ? max : offset
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.blockId === b.blockId && a.offset === b.offset
}

export function selectionsEqual(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return positionsEqual(a.anchor, b.anchor) && positionsEqual(a.focus, b.focus)
}

export function isCollapsed(selection: Selection): boolean {
  return positionsEqual(selection.anchor, selection.focus)
}

export function collapsedAt(position: Position): Selection {
  return { anchor: position, focus: position }
}

/**
 * Sorts a selection into document order.
 *
 * A selection carries anchor and focus rather than start and end because
 * direction is information — shift-arrow extends from the focus. Operations
 * don't care about direction, so they order it here, at the point of use.
 */
export function orderRange(document: Doc, selection: Selection): OrderedRange {
  const { anchor, focus } = selection

  if (anchor.blockId === focus.blockId) {
    return anchor.offset <= focus.offset
      ? { start: anchor, end: focus }
      : { start: focus, end: anchor }
  }

  const anchorIndex = blockIndex(document, anchor.blockId)
  const focusIndex = blockIndex(document, focus.blockId)

  return anchorIndex <= focusIndex
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor }
}

/** Splits a span at an offset. Either half may be empty; normalization deals
 *  with that rather than every caller checking. */
export function splitSpan(span: TextSpan, offsetInSpan: number): readonly [TextSpan, TextSpan] {
  return [
    { text: span.text.slice(0, offsetInSpan), marks: span.marks },
    { text: span.text.slice(offsetInSpan), marks: span.marks },
  ]
}
