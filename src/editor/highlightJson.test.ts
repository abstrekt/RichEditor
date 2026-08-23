import { describe, expect, it } from 'vitest'
import { highlightJson } from './highlightJson'
import type { JsonToken, JsonTokenKind } from './highlightJson'

/** The tokens that carry colour, with the structural filler dropped — what a
 *  reader of the panel actually distinguishes. */
const coloured = (json: string): ReadonlyArray<[JsonTokenKind, string]> =>
  highlightJson(json)
    .filter((token: JsonToken) => token.kind !== 'plain')
    .map((token) => [token.kind, token.text])

describe('highlightJson', () => {
  /* The property the panel depends on. Everything else here is about colour;
     this is about not lying about the document. */
  it('reproduces its input exactly', () => {
    const json = JSON.stringify(
      { blocks: [{ id: 'b1', spans: [{ text: 'a "quoted" \\ thing', marks: [] }] }] },
      null,
      2,
    )

    expect(
      highlightJson(json)
        .map((token) => token.text)
        .join(''),
    ).toBe(json)
  })

  it('distinguishes a key from a string value', () => {
    expect(coloured('{\n  "text": "text"\n}')).toEqual([
      ['key', '"text"'],
      ['string', '"text"'],
    ])
  })

  it('leaves the colon uncoloured', () => {
    const tokens = highlightJson('{"a": 1}')
    const afterKey = tokens[tokens.findIndex((token) => token.kind === 'key') + 1]

    expect(afterKey).toEqual({ text: ':', kind: 'plain' })
  })

  it('classifies numbers and atoms', () => {
    expect(coloured('[1, -2.5, 3e10, true, false, null]')).toEqual([
      ['number', '1'],
      ['number', '-2.5'],
      ['number', '3e10'],
      ['atom', 'true'],
      ['atom', 'false'],
      ['atom', 'null'],
    ])
  })

  /* An escaped quote must not end the string — otherwise the scanner falls out
     of sync and colours the rest of the document as if it were structure. */
  it('does not end a string on an escaped quote', () => {
    expect(coloured('{"href": "a \\" b"}')).toEqual([
      ['key', '"href"'],
      ['string', '"a \\" b"'],
    ])
  })

  /* Keywords and digits inside string content belong to the string. */
  it('does not tokenize inside string content', () => {
    expect(coloured('{"text": "true 42 null"}')).toEqual([
      ['key', '"text"'],
      ['string', '"true 42 null"'],
    ])
  })

  it('handles an empty document', () => {
    expect(highlightJson('')).toEqual([])
  })
})
