import type { Block, Doc, Mark, TextSpan } from '../model'

/**
 * Draws the document into the editable container.
 *
 * React never renders inside this subtree — it owns the container element and
 * nothing below it — so this is the only thing that writes here. That is the
 * point: React's reconciliation is correct only while it is the sole author of
 * a subtree, and a contenteditable region exists for something else to write
 * there. With no virtual DOM for these nodes, a browser-initiated mutation has
 * nothing to desync.
 *
 * The reconciliation is deliberately narrow: blocks keyed by id, contents
 * rebuilt only when the block object itself changed. Because operations are
 * immutable and share structure, an unchanged block is the *same object* as
 * last render, so that check is a reference comparison rather than a diff.
 *
 * Node identity matters more than it looks. Replacing the text node the caret
 * sits in destroys the selection, so the fewer nodes that change, the less
 * caret restoration has to do.
 */

/** What each span was rendered from, so the next pass can skip unchanged ones. */
const rendered = new WeakMap<HTMLElement, Doc>()

/* The modifier that opens a link differs by platform, and naming the wrong one
   in a tooltip is worse than naming none. navigator.platform is deprecated, so
   this reads the user agent instead — imperfect, but the cost of being wrong is
   a slightly off hint rather than broken behaviour, since both modifiers are
   accepted either way. */
const MODIFIER_HINT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? 'Cmd'
    : 'Ctrl'

const BLOCK_ID_ATTR = 'data-block-id'
const OFFSET_ATTR = 'data-offset'

export function renderDoc(container: HTMLElement, document: Doc): void {
  const previous = rendered.get(container)
  if (previous === document) return

  const existing = new Map<string, HTMLElement>()
  for (const child of Array.from(container.children)) {
    const id = child.getAttribute(BLOCK_ID_ATTR)
    if (id !== null && child instanceof HTMLElement) existing.set(id, child)
  }

  const previousBlocks = new Map(previous?.blocks.map((b) => [b.id, b]))

  document.blocks.forEach((block, index) => {
    const reused = existing.get(block.id)
    const element = reused ?? createBlockElement(block, container.ownerDocument)

    /* Reference equality, not deep comparison — immutable operations mean an
       untouched block arrives as the identical object. */
    if (!reused || previousBlocks.get(block.id) !== block) {
      fillBlock(element, block, container.ownerDocument)
    }

    existing.delete(block.id)

    if (container.children[index] !== element) {
      container.insertBefore(element, container.children[index] ?? null)
    }
  })

  for (const orphan of existing.values()) orphan.remove()

  rendered.set(container, document)
}

/** Discards the memo, forcing the next render to rebuild from scratch. Needed
 *  after anything writes into the container from outside — a composition
 *  session, for instance. */
export function invalidate(container: HTMLElement): void {
  rendered.delete(container)
}

function createBlockElement(block: Block, ownerDocument: Document): HTMLElement {
  const element = ownerDocument.createElement('p')
  element.setAttribute(BLOCK_ID_ATTR, block.id)
  element.className = 'editor-block'
  return element
}

function fillBlock(element: HTMLElement, block: Block, ownerDocument: Document): void {
  element.replaceChildren()

  let offset = 0
  let hasText = false

  for (const span of block.spans) {
    /* The sentinel empty span an emptied block keeps has no text to draw, and
       rendering it produces an element with no text node inside — which
       selection mapping would then have to walk past. The br below is what
       gives the block its line box. */
    if (span.text.length === 0) continue

    hasText = true
    element.appendChild(createSpanElement(span, offset, ownerDocument))
    offset += span.text.length
  }

  /*
   * An empty paragraph collapses to zero height and cannot be clicked into, so
   * it needs a line break to give it a line box. This is a rendering artifact
   * only — the model has no line-break node, and this element is never read
   * back as content.
   */
  if (!hasText) element.appendChild(ownerDocument.createElement('br'))
}

/**
 * One wrapper per span carrying its starting offset, with mark elements nested
 * inside it.
 *
 * The wrapper is uniform even for unmarked text, so mapping a browser selection
 * back to the model is "walk up to the nearest element with an offset" rather
 * than a special case per formatting combination.
 */
function createSpanElement(span: TextSpan, offset: number, ownerDocument: Document): HTMLElement {
  const wrapper = ownerDocument.createElement('span')
  wrapper.setAttribute(OFFSET_ATTR, String(offset))

  let host: HTMLElement = wrapper
  for (const mark of span.marks) {
    const element = createMarkElement(mark, ownerDocument)
    host.appendChild(element)
    host = element
  }

  host.appendChild(ownerDocument.createTextNode(span.text))
  return wrapper
}

function createMarkElement(mark: Mark, ownerDocument: Document): HTMLElement {
  switch (mark.type) {
    case 'bold':
      return ownerDocument.createElement('strong')

    case 'italic':
      return ownerDocument.createElement('em')

    case 'link': {
      const anchor = ownerDocument.createElement('a')
      anchor.setAttribute('href', mark.href)
      /* The only thing telling a reader where a link goes, since a plain click
         is reserved for placing the caret. */
      anchor.setAttribute('title', `${mark.href} — ${MODIFIER_HINT}+click to open`)
      return anchor
    }

    /* No default. Marks are a discriminated union, so adding one without a
       rendering rule is a compile error rather than unstyled text. */
  }
}
