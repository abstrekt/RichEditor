import { blockLength, clampOffset, findBlock } from '../model'
import type { Doc, Position, Selection } from '../model'

/**
 * The bidirectional bridge between browser selections and model positions.
 *
 * Deliberately thin. It pulls plain values out of DOM nodes, hands them to the
 * model's selection math, and writes plain values back — so the arithmetic that
 * can actually be wrong lives in a layer that is unit-testable without a
 * browser, and what remains here is node traversal.
 *
 * The DOM speaks in (node, offset-within-node). The model speaks in
 * (block id, offset-within-block). Rendering puts a starting offset on every
 * span wrapper, so translating one way is "walk up to the nearest wrapper, add
 * its offset" and the other way is "find the wrapper covering this offset".
 */

const BLOCK_ID_ATTR = 'data-block-id'
const OFFSET_ATTR = 'data-offset'

export function readSelection(container: HTMLElement, document: Doc): Selection | null {
  const domSelection = container.ownerDocument.getSelection()
  if (!domSelection || domSelection.rangeCount === 0) return null

  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection
  if (!anchorNode || !focusNode) return null
  if (!container.contains(anchorNode) || !container.contains(focusNode)) return null

  const anchor = toPosition(container, document, anchorNode, anchorOffset)
  const focus = toPosition(container, document, focusNode, focusOffset)
  if (!anchor || !focus) return null

  return { anchor, focus }
}

function toPosition(
  container: HTMLElement,
  document: Doc,
  node: Node,
  offsetInNode: number,
): Position | null {
  const blockElement = closestElement(node, `[${BLOCK_ID_ATTR}]`, container)
  const blockId = blockElement?.getAttribute(BLOCK_ID_ATTR)
  if (!blockId) return null

  const block = findBlock(document, blockId)
  if (!block) return null

  if (node.nodeType === Node.TEXT_NODE) {
    const wrapper = closestElement(node, `[${OFFSET_ATTR}]`, container)
    const spanStart = Number(wrapper?.getAttribute(OFFSET_ATTR) ?? 0)
    return { blockId, offset: clampOffset(block, spanStart + offsetInNode) }
  }

  /*
   * The selection landed on an element rather than inside text. That happens in
   * an empty block, which contains only a <br> and so has no text node to
   * address, and after a click that lands between children.
   *
   * The element's child index is a count of spans, not of characters, so it
   * cannot be used as an offset. Falling back to the block's start or end is
   * correct for the empty-block case and a reasonable approximation otherwise.
   */
  const atEnd = offsetInNode > 0
  return { blockId, offset: atEnd ? blockLength(block) : 0 }
}

export function writeSelection(container: HTMLElement, selection: Selection): void {
  const anchor = toDomPoint(container, selection.anchor)
  const focus = toDomPoint(container, selection.focus)
  if (!anchor || !focus) return

  const domSelection = container.ownerDocument.getSelection()
  if (!domSelection) return

  /* setBaseAndExtent rather than a Range, because a Range is inherently
     ordered and would silently discard which end is live — and shift-arrow
     extends from the focus. */
  domSelection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
}

interface DomPoint {
  readonly node: Node
  readonly offset: number
}

function toDomPoint(container: HTMLElement, position: Position): DomPoint | null {
  const blockElement = container.querySelector(
    `[${BLOCK_ID_ATTR}="${cssEscape(position.blockId)}"]`,
  )
  if (!(blockElement instanceof HTMLElement)) return null

  const wrappers = Array.from(blockElement.querySelectorAll(`[${OFFSET_ATTR}]`))

  /* An empty block has a <br> and no text, so the caret goes on the block
     element itself. */
  if (wrappers.length === 0) return { node: blockElement, offset: 0 }

  /*
   * Walk backwards to find the last wrapper starting at or before the target.
   * Backwards because a position on a span boundary belongs to the span that
   * ends there, not the one that begins there — the same backward bias the
   * affinity rule uses, so the caret and the formatting it inherits never
   * disagree about which side of a boundary they are on.
   */
  for (let i = wrappers.length - 1; i >= 0; i--) {
    const wrapper = wrappers[i]
    if (!wrapper) continue

    const start = Number(wrapper.getAttribute(OFFSET_ATTR) ?? 0)
    if (start > position.offset && i > 0) continue

    const textNode = firstTextNode(wrapper)
    if (!textNode) continue

    const withinSpan = Math.min(
      Math.max(position.offset - start, 0),
      textNode.textContent?.length ?? 0,
    )
    return { node: textNode, offset: withinSpan }
  }

  return { node: blockElement, offset: 0 }
}

function firstTextNode(root: Node): Text | null {
  if (root.nodeType === Node.TEXT_NODE) return root as Text
  for (const child of Array.from(root.childNodes)) {
    const found = firstTextNode(child)
    if (found) return found
  }
  return null
}

function closestElement(node: Node, selector: string, container: HTMLElement): HTMLElement | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode
  if (!(start instanceof Element)) return null

  const match = start.closest(selector)
  return match instanceof HTMLElement && container.contains(match) ? match : null
}

/** Block ids come from crypto.randomUUID, but escaping keeps the selector
 *  correct if that ever changes. */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value
}
