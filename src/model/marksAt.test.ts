import { describe, expect, it } from 'vitest'
import { block, doc, span } from './doc'
import { effectiveMarks, markState, marksAtPosition, shouldRemove } from './marksAt'
import type { EditorState, Mark, Selection } from './types'

const bold: Mark = { type: 'bold' }

const caret = (offset: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
})
const range = (from: number, to: number, blockId = 'b1'): Selection => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
})

/*  "Hello world" with "world" bold.
 *
 *      H  e  l  l  o     w  o  r  l  d
 *     0  1  2  3  4  5  6  7  8  9 10 11
 *                        |____bold____|
 */
const mixed = doc([block('b1', [span('Hello '), span('world', [bold])])])
const state = (document = mixed, selection: Selection | null = null): EditorState => ({
  doc: document,
  selection,
  pendingMarks: null,
})

describe('marksAtPosition — backward affinity', () => {
  it('inherits from the character to the left', () => {
    /* The dominant case: finish typing a bold word, keep going, stay bold. */
    expect(marksAtPosition(mixed, caret(11))).toEqual([bold])
  })

  it('takes the earlier span at a boundary, not the later one', () => {
    /* Offset 6 is both the end of "Hello " and the start of "world". Clicking
       just before a bold word and typing should not come out bold. */
    expect(marksAtPosition(mixed, caret(6))).toEqual([])
  })

  it('falls forward at the start of a block', () => {
    /* Nothing to the left, so it takes the character on the right — otherwise
       typing at the head of a bold paragraph would come out unformatted. */
    const allBold = doc([block('b1', [span('Hello', [bold])])])
    expect(marksAtPosition(allBold, caret(0))).toEqual([bold])
  })
})

describe('effectiveMarks', () => {
  it('prefers explicit intent over what would be inherited', () => {
    /* Pressing Ctrl+B just after a bold word means *not* bold, which affinity
       alone cannot express — hence a complete mark set rather than a list of
       marks to add. */
    const withIntent: EditorState = { ...state(mixed, caret(11)), pendingMarks: [] }
    expect(effectiveMarks(withIntent)).toEqual([])
  })

  it('falls back to affinity when there is no explicit intent', () => {
    expect(effectiveMarks(state(mixed, caret(11)))).toEqual([bold])
  })
})

describe('markState — what the toolbar shows', () => {
  it('reports active when every character carries the mark', () => {
    expect(markState(state(mixed, range(6, 11))).active).toContain('bold')
  })

  it('reports mixed when only some do', () => {
    const result = markState(state(mixed, range(3, 11)))
    expect(result.mixed).toContain('bold')
    expect(result.active).not.toContain('bold')
  })

  it('reports neither when none do', () => {
    const result = markState(state(mixed, range(0, 5)))
    expect(result.active).not.toContain('bold')
    expect(result.mixed).not.toContain('bold')
  })

  it('reports what the next character would carry when the caret is collapsed', () => {
    /* There are no characters to survey, so the button reflects what pressing
       a key would produce — which is what it is really telling you. */
    expect(markState(state(mixed, caret(11))).active).toContain('bold')
  })
})
describe('shouldRemove — whether a toggle takes the mark away', () => {
  it('is false when the range is only partly marked', () => {
    expect(shouldRemove(state(mixed, range(3, 11)), 'bold')).toBe(false)
  })

  it('is true only when every character already carries the mark', () => {
    expect(shouldRemove(state(mixed, range(6, 11)), 'bold')).toBe(true)
  })

  it('follows what the caret would inherit when the selection is collapsed', () => {
    expect(shouldRemove(state(mixed, caret(11)), 'bold')).toBe(true)
    expect(shouldRemove(state(mixed, caret(3)), 'bold')).toBe(false)
  })
})
