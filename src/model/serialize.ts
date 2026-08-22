import { normalizeDoc } from './normalize'
import type { Block, Doc, Mark, TextSpan } from './types'

/**
 * The model is already plain JSON-shaped data — no classes, no functions, no
 * cycles — so writing it out is nearly free. Reading it back is where the work
 * is: an incoming value is `unknown`, and trusting it would let a malformed
 * document reach code whose correctness depends on invariants it never checked.
 *
 * So deserialization validates the shape, then normalizes. Nothing
 * non-canonical gets in through the door, which is what makes the round-trip
 * property hold: parsing what we serialized returns something deep-equal to
 * what we started with.
 */

export class DocumentParseError extends Error {
  constructor(
    message: string,
    /** Where in the document the problem is, e.g. `blocks[2].spans[0].marks[1]`. */
    readonly path: string,
  ) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'DocumentParseError'
  }
}

export function toJSON(document: Doc): string {
  return JSON.stringify(document)
}

export function fromJSON(json: string): Doc {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (cause) {
    throw new DocumentParseError(
      cause instanceof Error ? cause.message : 'Invalid JSON',
      '',
    )
  }
  return deserialize(parsed)
}

/** Validates an already-parsed value. Split out so callers holding a plain
 *  object don't have to stringify it just to get it checked. */
export function deserialize(value: unknown): Doc {
  const root = expectObject(value, '')

  const blocks = root['blocks']
  if (!Array.isArray(blocks)) {
    throw new DocumentParseError('Expected an array of blocks', 'blocks')
  }
  if (blocks.length === 0) {
    throw new DocumentParseError('A document must hold at least one block', 'blocks')
  }

  const seenIds = new Set<string>()
  const parsedBlocks = blocks.map((raw, i) => {
    const parsedBlock = parseBlock(raw, `blocks[${i}]`)
    if (seenIds.has(parsedBlock.id)) {
      throw new DocumentParseError(
        `Duplicate block id "${parsedBlock.id}". Ids must be unique — positions ` +
          'address blocks by id, so a duplicate makes a position ambiguous.',
        `blocks[${i}].id`,
      )
    }
    seenIds.add(parsedBlock.id)
    return parsedBlock
  })

  return normalizeDoc({ blocks: parsedBlocks })
}

function parseBlock(value: unknown, path: string): Block {
  const raw = expectObject(value, path)

  const id = raw['id']
  if (typeof id !== 'string' || id.length === 0) {
    throw new DocumentParseError('Expected a non-empty string id', `${path}.id`)
  }

  if (raw['type'] !== 'paragraph') {
    throw new DocumentParseError(
      `Unknown block type ${JSON.stringify(raw['type'])}. Only "paragraph" is supported.`,
      `${path}.type`,
    )
  }

  const spans = raw['spans']
  if (!Array.isArray(spans)) {
    throw new DocumentParseError('Expected an array of spans', `${path}.spans`)
  }

  return {
    id,
    type: 'paragraph',
    spans: spans.map((span, i) => parseSpan(span, `${path}.spans[${i}]`)),
  }
}

function parseSpan(value: unknown, path: string): TextSpan {
  const raw = expectObject(value, path)

  const text = raw['text']
  if (typeof text !== 'string') {
    throw new DocumentParseError('Expected a string', `${path}.text`)
  }

  const marks = raw['marks']
  if (!Array.isArray(marks)) {
    throw new DocumentParseError('Expected an array of marks', `${path}.marks`)
  }

  return { text, marks: marks.map((mark, i) => parseMark(mark, `${path}.marks[${i}]`)) }
}

function parseMark(value: unknown, path: string): Mark {
  const raw = expectObject(value, path)
  const type = raw['type']

  switch (type) {
    case 'bold':
    case 'italic':
      return { type }

    case 'link': {
      const href = raw['href']
      if (typeof href !== 'string' || href.length === 0) {
        throw new DocumentParseError(
          'A link mark requires a non-empty href',
          `${path}.href`,
        )
      }
      return { type: 'link', href }
    }

    default:
      throw new DocumentParseError(
        `Unknown mark type ${JSON.stringify(type)}. Expected "bold", "italic" or "link".`,
        `${path}.type`,
      )
  }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DocumentParseError(`Expected an object, received ${describe(value)}`, path)
  }
  return value as Record<string, unknown>
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}
