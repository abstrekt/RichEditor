/**
 * The document model.
 *
 * Every type here is deeply readonly. Operations produce new documents rather
 * than mutating existing ones, which is what makes undo history cheap — an
 * edited document shares object references with its predecessor for every part
 * that did not change.
 */

/** One piece of formatting applied to a run of text. */
export type Mark =
  | { readonly type: 'bold' }
  | { readonly type: 'italic' }
  | { readonly type: 'link'; readonly href: string }

export type MarkType = Mark['type']

/**
 * A run of text sharing the same formatting. Text is cut at every formatting
 * boundary, so "Hello world" with "world" bold is two spans.
 */
export interface TextSpan {
  readonly text: string
  readonly marks: readonly Mark[]
}

/** One paragraph. */
export interface Block {
  readonly id: string
  readonly type: 'paragraph'
  readonly spans: readonly TextSpan[]
}

export interface Doc {
  readonly blocks: readonly Block[]
}

/**
 * Where the cursor is: a block, plus a count of UTF-16 code units into that
 * block's flattened text.
 *
 * Deliberately not a path into the span array. Normalization re-segments spans
 * after every operation, so a path pointing at span 1 becomes a dangling
 * reference the moment spans 0 and 1 merge. A character count is unaffected,
 * because merging spans never moves a character.
 */
export interface Position {
  readonly blockId: string
  readonly offset: number
}

/**
 * A selection is two positions, not an ordered pair. `anchor` is where the
 * drag started and `focus` is where it ended — shift-arrow extends from the
 * focus, so which end is live is information that an ordered start/end would
 * throw away. Sort into start/end only where an operation needs a range.
 */
export interface Selection {
  readonly anchor: Position
  readonly focus: Position
}

export interface EditorState {
  readonly doc: Doc
  readonly selection: Selection | null
  /**
   * Formatting the user asked for that has nothing to attach to yet — pressing
   * Bold with a collapsed cursor.
   *
   * A complete mark set rather than a list of marks to add, because it has to
   * be able to express "explicitly not bold" against an affinity that would
   * otherwise infer bold. `null` means no explicit intent: fall back to
   * affinity. Cleared to `null` on any caret movement.
   */
  readonly pendingMarks: readonly Mark[] | null
}
