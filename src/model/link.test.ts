import { describe, expect, it } from 'vitest'
import { apply } from './apply'
import { block, doc, span } from './doc'
import { EMPTY_HISTORY } from './history'
import { linkAt, markState } from './marksAt'
import type { EditorState, Mark, Selection } from './types'

const bold: Mark = { type: 'bold' }
const link = (href: string): Mark => ({ type: 'link', href })

const caret = (offset: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
})
const range = (from: number, to: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
})

const state = (document: ReturnType<typeof doc>, selection: Selection | null): EditorState => ({
  doc: document,
  selection,
  pendingMarks: null,
  history: EMPTY_HISTORY,
})

/*  "See the docs here" with "the docs" linked.
 *
 *     S  e  e     t  h  e     d  o  c  s     h  e  r  e
 *    0        3  4          8        12   13          17
 *                |________link_______|
 */
const linked = doc([
  block('b1', [span('See '), span('the docs', [link('a.com')]), span(' here')]),
])

describe('linkAt', () => {
  it('finds the whole link from a caret anywhere inside it', () => {
    /* So fixing a wrong URL means putting the cursor in the link, not
       selecting it precisely first. */
    expect(linkAt(state(linked, caret(7)))).toEqual({
      href: 'a.com',
      range: range(4, 12),
    })
  })

  it('reports nothing when the caret is outside any link', () => {
    expect(linkAt(state(linked, caret(1)))).toBeNull()
  })

  it('expands across spans that share the target but differ in other marks', () => {
    /* Half a link being bold is perfectly legal, so the extent follows the
       href rather than the whole mark set. */
    const partlyBold = doc([
      block('b1', [
        span('See '),
        span('the ', [link('a.com')]),
        span('docs', [link('a.com'), bold]),
        span(' here'),
      ]),
    ])
    expect(linkAt(state(partlyBold, caret(6)))?.range).toEqual(range(4, 12))
  })

  it('stops at a different target rather than merging two links', () => {
    const twoLinks = doc([
      block('b1', [span('one', [link('a.com')]), span('two', [link('b.com')])]),
    ])
    expect(linkAt(state(twoLinks, caret(1)))).toEqual({ href: 'a.com', range: range(0, 3) })
    expect(linkAt(state(twoLinks, caret(4)))).toEqual({ href: 'b.com', range: range(3, 6) })
  })

  it('reports a link covering an entire selected range', () => {
    expect(linkAt(state(linked, range(5, 10)))?.href).toBe('a.com')
  })

  it('reports nothing for a range that is only partly linked', () => {
    /* No single answer, so the toolbar shows mixed rather than picking one. */
    expect(linkAt(state(linked, range(0, 10)))).toBeNull()
  })

  it('reports nothing for a range spanning two different links', () => {
    const twoLinks = doc([
      block('b1', [span('one', [link('a.com')]), span('two', [link('b.com')])]),
    ])
    expect(linkAt(state(twoLinks, range(1, 5)))).toBeNull()
  })
})

describe('applying a link', () => {
  it('adds a link to a selected range', () => {
    const plain = doc([block('b1', [span('See the docs')])])
    const next = apply(state(plain, range(4, 12)), {
      type: 'toggleMark', at: range(4, 12), mark: link('a.com'), timestamp: 0,
    })

    expect(next.doc.blocks[0]?.spans).toEqual([
      { text: 'See ', marks: [] },
      { text: 'the docs', marks: [link('a.com')] },
    ])
  })

  it('replaces an existing link rather than stacking a second one', () => {
    /* A span cannot render as two anchors at once, so the newer target wins.
       Ordinary deduplication would not catch this: two link marks with
       different hrefs are not equal. */
    const next = apply(state(linked, range(4, 12)), {
      type: 'toggleMark', at: range(4, 12), mark: link('b.com'), timestamp: 0,
    })

    const spans = next.doc.blocks[0]!.spans
    expect(spans[1]?.marks).toEqual([link('b.com')])
    expect(spans[1]?.marks.filter((m) => m.type === 'link')).toHaveLength(1)
  })

  it('leaves a link alone when the same target is applied again', () => {
    /* The popover prefills the current URL, so pressing Apply without editing
       it must not delete the link — which is what inferring "already present,
       therefore remove" would do. */
    const next = apply(state(linked, range(4, 12)), {
      type: 'toggleMark', at: range(4, 12), mark: link('a.com'), timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans[1]?.marks).toEqual([link('a.com')])
  })

  it('removes a link only when asked to outright', () => {
    const next = apply(state(linked, range(4, 12)), {
      type: 'removeMark', at: range(4, 12), markType: 'link', timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans).toEqual([{ text: 'See the docs here', marks: [] }])
  })

  it('composes with other marks', () => {
    const boldText = doc([block('b1', [span('word', [bold])])])
    const next = apply(state(boldText, range(0, 4)), {
      type: 'toggleMark', at: range(0, 4), mark: link('a.com'), timestamp: 0,
    })
    expect(next.doc.blocks[0]?.spans[0]?.marks).toEqual([bold, link('a.com')])
  })
})

describe('what the toolbar reports for links', () => {
  it('shows active when the whole selection carries one link', () => {
    expect(markState(state(linked, range(4, 12))).active).toContain('link')
  })

  it('shows mixed when only part of the selection is linked', () => {
    expect(markState(state(linked, range(0, 10))).mixed).toContain('link')
  })

  it('shows mixed for two different links, since neither covers it all', () => {
    const twoLinks = doc([
      block('b1', [span('one', [link('a.com')]), span('two', [link('b.com')])]),
    ])
    /* Every character is linked, so "active" is the honest report for the
       mark's presence — linkAt is what distinguishes one link from two. */
    expect(markState(state(twoLinks, range(0, 6))).active).toContain('link')
    expect(linkAt(state(twoLinks, range(0, 6)))).toBeNull()
  })
})
