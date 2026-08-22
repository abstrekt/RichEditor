import { hasMark } from './marks'
import { blockIndex, isCollapsed, orderRange, resolvePosition } from './selection'
import type { Doc, EditorState, Mark, MarkType, Selection, TextSpan } from './types'

/**
 * What formatting applies where.
 *
 * The toolbar and the rule for what newly typed text inherits are the same
 * question asked at two scales, so they are answered here rather than in two
 * places that could drift apart.
 */

/** Three states, because a selection can be partly formatted. */
export interface MarkState {
  /** Every character in the selection carries it. Pressing the button removes it. */
  readonly active: readonly MarkType[]
  /** Some characters carry it. Pressing the button adds it to the rest. */
  readonly mixed: readonly MarkType[]
}

const MARK_TYPES: readonly MarkType[] = ['bold', 'italic', 'link']

/**
 * The marks a character typed at this position should inherit.
 *
 * Backward affinity: take the formatting of the character to the left, so
 * carrying on typing at the end of a bold word stays bold — by far the most
 * common case. At offset 0 there is nothing to the left, so it falls back to
 * the character on the right; otherwise typing at the head of a bold paragraph
 * would come out unformatted.
 *
 * Both cases fall out of `resolvePosition` for free, because it already
 * resolves a boundary offset to the span that *ends* there rather than the one
 * that begins. The position model and the affinity rule agree by construction
 * rather than by two functions happening to make the same choice.
 */
export function marksAtPosition(document: Doc, selection: Selection): readonly Mark[] {
  const focus = selection.focus
  const block = document.blocks.find((b) => b.id === focus.blockId)
  if (!block) return []

  const { spanIndex } = resolvePosition(block, focus.offset)
  return block.spans[spanIndex]?.marks ?? []
}

/**
 * What formatting newly typed text carries.
 *
 * An explicit toggle outranks affinity. Pressing Ctrl+B just after a bold word
 * has to be able to mean *not* bold, contradicting what would otherwise be
 * inherited — which is why pending marks hold a complete mark set rather than a
 * list of marks to add.
 */
export function effectiveMarks(state: EditorState): readonly Mark[] {
  if (state.pendingMarks) return state.pendingMarks
  if (!state.selection) return []
  return marksAtPosition(state.doc, state.selection)
}

/** Every span the range covers, clipped to it. */
export function spansInRange(document: Doc, selection: Selection): readonly TextSpan[] {
  const { start, end } = orderRange(document, selection)
  const firstIndex = blockIndex(document, start.blockId)
  const lastIndex = blockIndex(document, end.blockId)
  if (firstIndex === -1 || lastIndex === -1) return []

  const result: TextSpan[] = []

  for (let i = firstIndex; i <= lastIndex; i++) {
    const block = document.blocks[i]
    if (!block) continue

    const from = i === firstIndex ? start.offset : 0
    const to = i === lastIndex ? end.offset : Number.POSITIVE_INFINITY

    let offset = 0
    for (const span of block.spans) {
      const spanStart = offset
      const spanEnd = offset + span.text.length
      offset = spanEnd

      if (spanEnd <= from || spanStart >= to) continue

      const sliced = span.text.slice(
        Math.max(from - spanStart, 0),
        Math.min(to - spanStart, span.text.length),
      )
      if (sliced.length > 0) result.push({ text: sliced, marks: span.marks })
    }
  }

  return result
}

/**
 * Which marks the toolbar should show as on, off, or mixed.
 *
 * With a collapsed caret there are no characters to survey, so it reports what
 * the next typed character would carry — which is what the button is really
 * telling you.
 */
export function markState(state: EditorState): MarkState {
  const selection = state.selection
  if (!selection) return { active: [], mixed: [] }

  if (isCollapsed(selection)) {
    const marks = effectiveMarks(state)
    return { active: marks.map((m) => m.type), mixed: [] }
  }

  const spans = spansInRange(state.doc, selection)
  if (spans.length === 0) return { active: [], mixed: [] }

  const active: MarkType[] = []
  const mixed: MarkType[] = []

  for (const type of MARK_TYPES) {
    const count = spans.filter((span) => hasMark(span.marks, type)).length
    if (count === spans.length) active.push(type)
    else if (count > 0) mixed.push(type)
  }

  return { active, mixed }
}

/**
 * Whether toggling should remove rather than add.
 *
 * Removal happens only when every character already carries the mark. Pressing
 * a format button is a statement of intent to apply, so anything short of
 * "already fully applied" is read as "apply to the rest".
 */
export function shouldRemove(state: EditorState, type: MarkType): boolean {
  const selection = state.selection
  if (!selection) return false

  if (isCollapsed(selection)) {
    return effectiveMarks(state).some((m) => m.type === type)
  }

  const spans = spansInRange(state.doc, selection)
  return spans.length > 0 && spans.every((span) => hasMark(span.marks, type))
}
