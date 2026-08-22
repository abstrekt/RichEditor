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
