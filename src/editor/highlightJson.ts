/**
 * A minimal tokenizer for already-formatted JSON, used only to colour the
 * serialized-document panel.
 *
 * It deliberately does not parse. The input is always the output of
 * `JSON.stringify` on a document we just validated, so the grammar is known to
 * be well-formed and the only question is which colour each run of characters
 * takes. A scanner is a few lines; a parser would be a second, redundant
 * implementation of `serialize.ts` that could disagree with it.
 *
 * The one invariant that matters: concatenating every token's text reproduces
 * the input exactly. Highlighting must never alter the JSON being shown, since
 * the whole point of the panel is to show what was written.
 */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'atom' | 'plain'

export interface JsonToken {
  readonly text: string
  readonly kind: JsonTokenKind
}

/*
 * Alternation order is significant: strings first, so that a `true` or a digit
 * sitting inside string content is consumed as part of that string rather than
 * matching on its own.
 *
 * The trailing `(\s*:)` group is what separates a key from a value — in JSON
 * the two are lexically identical, and only the following colon tells them
 * apart. It is captured rather than looked ahead so it can be emitted as its
 * own uncoloured token.
 */
const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

export function highlightJson(json: string): readonly JsonToken[] {
  const tokens: JsonToken[] = []
  let lastIndex = 0

  /* Structure and whitespace — braces, brackets, commas, indentation — is
     whatever the regex steps over. It needs no colour of its own: the panel's
     base text colour is already the muted weight punctuation should have. */
  const pushPlain = (text: string) => {
    if (text) tokens.push({ text, kind: 'plain' })
  }

  TOKEN.lastIndex = 0
  for (let match = TOKEN.exec(json); match; match = TOKEN.exec(json)) {
    pushPlain(json.slice(lastIndex, match.index))
    lastIndex = match.index + match[0].length

    const quoted = match[1]
    const colon = match[2]

    if (quoted !== undefined) {
      tokens.push({ text: quoted, kind: colon === undefined ? 'string' : 'key' })
      /* The colon and any space before it stay plain, so a key reads as a
         label rather than the punctuation bleeding into its colour. */
      if (colon !== undefined) pushPlain(colon)
      continue
    }

    tokens.push({
      text: match[0],
      kind: /^[-\d]/.test(match[0]) ? 'number' : 'atom',
    })
  }

  pushPlain(json.slice(lastIndex))

  return tokens
}
