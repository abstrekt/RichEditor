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

export type { MarkState } from './marksAt'
export {
  effectiveMarks,
  markState,
  marksAtPosition,
  shouldRemove,
  spansInRange,
} from './marksAt'

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
  selectionsEqual,
  splitSpan,
} from './selection'

/*
 * `apply` is the whole public surface for changing a document. The raw
 * operations behind it are not exported: they return documents that have not
 * been normalized, and nothing outside this module should ever hold one.
 */
export type { DeleteUnit } from './operations'
export type { Action, Operation } from './apply'
export { apply } from './apply'

export type { EditSignature, History, Snapshot } from './history'
export { COALESCE_WINDOW_MS, EMPTY_HISTORY, canRedo, canUndo, coalesces } from './history'

export { DocumentParseError, deserialize, fromJSON, toJSON } from './serialize'
