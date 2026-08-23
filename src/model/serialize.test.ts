import { describe, expect, it } from 'vitest'
import { block, doc, paragraph, span } from './doc'
import { DocumentParseError, deserialize, fromJSON, toJSON } from './serialize'
import type { Doc, Mark } from './types'

const bold: Mark = { type: 'bold' }
const italic: Mark = { type: 'italic' }
const link = (href: string): Mark => ({ type: 'link', href })

/** The brief's requirement, stated as a function: writing a document out and
 *  reading it back must produce the same document. */
const roundTrip = (document: Doc): Doc => fromJSON(toJSON(document))

describe('round trip', () => {
  it('preserves a plain document', () => {
    const original = doc([paragraph('b1', 'Hello world')])
    expect(roundTrip(original)).toEqual(original)
  })

  it('preserves marks, including a link target', () => {
    const original = doc([
      block('b1', [
        span('See '),
        span('the docs', [link('https://example.com')]),
        span(' now', [bold, italic]),
      ]),
    ])
    expect(roundTrip(original)).toEqual(original)
  })

  it('preserves multiple blocks and their ids', () => {
    const original = doc([paragraph('b1', 'first'), paragraph('b2', 'second')])
    expect(roundTrip(original)).toEqual(original)
    expect(roundTrip(original).blocks.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('preserves an empty block, sentinel span and all', () => {
    const original = doc([paragraph('b1', 'text'), paragraph('b2', '')])
    const restored = roundTrip(original)
    expect(restored).toEqual(original)
    expect(restored.blocks[1]?.spans).toEqual([{ text: '', marks: [] }])
  })

  it('preserves text the JSON encoder has opinions about', () => {
    /* Quotes, backslashes, newlines, and characters outside the basic plane —
       all of which JSON.stringify escapes and JSON.parse must restore exactly,
       since offsets count code units. */
    const awkward = 'quote " backslash \\ newline \n tab \t emoji \u{1F468}‍\u{1F469}‍\u{1F467}'
    const original = doc([paragraph('b1', awkward)])
    const restored = roundTrip(original)

    expect(restored).toEqual(original)
    expect(restored.blocks[0]?.spans[0]?.text).toBe(awkward)
    expect(restored.blocks[0]?.spans[0]?.text.length).toBe(awkward.length)
  })

  it('is stable across repeated round trips', () => {
    const original = doc([block('b1', [span('a', [bold]), span('b')])])
    expect(roundTrip(roundTrip(original))).toEqual(original)
  })

  it('produces identical JSON for documents that render the same', () => {
    /* Two ways of arriving at the same bold text — typed then bolded, or
       bolded in two halves. Normalization on the way in is what makes the
       serialized form canonical rather than merely valid. */
    const inOnePiece = toJSON(doc([block('b1', [span('hello', [bold])])]))
    const inTwoPieces = toJSON(doc([block('b1', [span('he', [bold]), span('llo', [bold])])]))
    expect(inTwoPieces).toBe(inOnePiece)
  })
})

describe('normalizing on the way in', () => {
  it('merges adjacent spans that arrive separated', () => {
    /* A document written by an older version, or by hand, must not be able to
       enter in a non-canonical shape — everything downstream assumes it. */
    const restored = deserialize({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          spans: [
            { text: 'he', marks: [{ type: 'bold' }] },
            { text: 'llo', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })
    expect(restored.blocks[0]?.spans).toEqual([{ text: 'hello', marks: [bold] }])
  })

  it('canonicalises mark order', () => {
    const restored = deserialize({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          spans: [{ text: 'x', marks: [{ type: 'italic' }, { type: 'bold' }] }],
        },
      ],
    })
    expect(restored.blocks[0]?.spans[0]?.marks).toEqual([bold, italic])
  })

  it('keeps only one link per span', () => {
    const restored = deserialize({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          spans: [
            {
              text: 'x',
              marks: [
                { type: 'link', href: 'a.com' },
                { type: 'link', href: 'b.com' },
              ],
            },
          ],
        },
      ],
    })
    expect(restored.blocks[0]?.spans[0]?.marks).toEqual([link('b.com')])
  })
})

describe('rejecting malformed input', () => {
  const expectRejection = (value: unknown, pattern: RegExp) =>
    expect(() => deserialize(value)).toThrow(pattern)

  it('rejects a value that is not an object', () => {
    expectRejection('nope', /Expected an object/)
    expectRejection(null, /Expected an object/)
    expectRejection([], /Expected an object/)
  })

  it('rejects a document with no blocks', () => {
    /* A document always holds at least one block, so zero is not an empty
       document — it is a malformed one. */
    expectRejection({ blocks: [] }, /at least one block/)
  })

  it('rejects duplicate block ids', () => {
    /* Positions address blocks by id, so a duplicate makes a position
       ambiguous rather than merely untidy. */
    expectRejection(
      {
        blocks: [
          { id: 'b1', type: 'paragraph', spans: [{ text: 'a', marks: [] }] },
          { id: 'b1', type: 'paragraph', spans: [{ text: 'b', marks: [] }] },
        ],
      },
      /Duplicate block id/,
    )
  })

  it('rejects an unknown block type', () => {
    expectRejection(
      { blocks: [{ id: 'b1', type: 'heading', spans: [] }] },
      /Unknown block type/,
    )
  })

  it('rejects an unknown mark type', () => {
    expectRejection(
      {
        blocks: [
          { id: 'b1', type: 'paragraph', spans: [{ text: 'x', marks: [{ type: 'underline' }] }] },
        ],
      },
      /Unknown mark type/,
    )
  })

  it('rejects a link with no target', () => {
    expectRejection(
      {
        blocks: [
          { id: 'b1', type: 'paragraph', spans: [{ text: 'x', marks: [{ type: 'link' }] }] },
        ],
      },
      /requires a non-empty href/,
    )
  })

  it('rejects a span whose text is not a string', () => {
    expectRejection(
      { blocks: [{ id: 'b1', type: 'paragraph', spans: [{ text: 42, marks: [] }] }] },
      /Expected a string/,
    )
  })

  it('rejects invalid JSON with the parser message intact', () => {
    expect(() => fromJSON('{ not json')).toThrow(DocumentParseError)
  })

  it('names where the problem is', () => {
    /* "Invalid document" is useless when the document has a hundred blocks. */
    try {
      deserialize({
        blocks: [
          { id: 'b1', type: 'paragraph', spans: [{ text: 'ok', marks: [] }] },
          {
            id: 'b2',
            type: 'paragraph',
            spans: [{ text: 'x', marks: [{ type: 'link', href: '' }] }],
          },
        ],
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentParseError)
      expect((error as DocumentParseError).path).toBe('blocks[1].spans[0].marks[0].href')
    }
  })
})
