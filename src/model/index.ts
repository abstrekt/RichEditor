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
