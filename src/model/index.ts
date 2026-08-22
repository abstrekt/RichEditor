export type {
  Block,
  Doc,
  EditorState,
  Mark,
  MarkType,
  Position,
  Selection,
  TextSpan,
} from './types'

export { block, createEmptyDoc, doc, paragraph, span } from './doc'

export {
  canonicalizeMarks,
  findMark,
  hasMark,
  markEquals,
  marksEqual,
  withMark,
  withoutMark,
} from './marks'

export { normalizeBlock, normalizeDoc, normalizeSpans } from './normalize'

export type { OrderedRange, SpanPoint } from './selection'
export {
  blockIndex,
  blockLength,
  blockText,
  clampOffset,
  collapsedAt,
  findBlock,
  flattenOffset,
  isCollapsed,
  orderRange,
  positionsEqual,
  resolvePosition,
  splitSpan,
} from './selection'

/*
 * `apply` is the whole public surface for changing a document. The raw
 * operations behind it are not exported: they return documents that have not
 * been normalized, and nothing outside this module should ever hold one.
 */
export type { Operation } from './apply'
export { apply } from './apply'

export { DocumentParseError, deserialize, fromJSON, toJSON } from './serialize'
