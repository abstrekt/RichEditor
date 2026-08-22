# CLAUDE.md

Working rules for this repository. These are constraints, not suggestions —
most of them exist because something downstream silently breaks without them.

## What this is

A rich-text editor where a JSON document model is the single source of truth
and the `contenteditable` DOM is purely a projection of it. Bold, italic, link,
undo/redo. Architecture is the deliverable; the feature list is deliberately
small.

## Commands

```bash
pnpm install        # pnpm, not npm — see README
pnpm dev            # vite dev server
pnpm typecheck      # tsc --noEmit, must be clean before any commit
pnpm test           # vitest, node environment
pnpm test:watch
```

## The update loop

Everything hangs off one cycle. Understand it before changing anything:

```
beforeinput  →  preventDefault()  →  interpret inputType  →  pure operation
     →  normalize  →  new EditorState  →  useLayoutEffect  →  renderDoc
     →  writeSelection
```

The browser never writes into the editable. Every `beforeinput` is prevented,
including the ones we don't handle — silently ignoring an unsupported input is
fine, letting the browser handle it is not.

## Hard rules

### 1. `src/model/` never imports a DOM API

Not `document`, not `window`, not `Node`, not `Selection` — and no DOM types in
any signature. The test suite runs in a node environment specifically so this
fails loudly rather than passing under jsdom.

This is what makes the brief's "logic tests, not DOM snapshots" structurally
true. Selection *math* lives in the model as pure functions over plain data;
the DOM adapter extracts plain data from nodes and calls into it.

### 2. Normalization invariants

Enforced in one place, relied on everywhere. After `normalize()`:

1. No span has empty text — **unless it is the only span in its block**
2. No two adjacent spans have equal marks
3. Marks are sorted by type and contain no duplicates
4. **At most one link mark per span**
5. Every block has at least one span
6. The document has at least one block

Rule 1's exception is load-bearing: it keeps rule 5 whole, which keeps
`resolvePosition` and every insertion path free of null checks. Rule 4 is not
automatic — two link marks with different hrefs are not equal and would not
dedupe on their own.

### 3. Raw operations are never exported

Operations change the document and stop. They may return a non-canonical
document. Everything goes through one `apply()`, which normalizes, remaps the
selection, and pushes history — the single seam where a user action becomes a
state transition. If you add an operation, it does not get to skip that.

### 4. Positions are `{ blockId, offset }`, never paths

`offset` counts **UTF-16 code units**, matching both `string.length` and DOM
offsets, so no conversion layer exists. A path into the span array would dangle
the moment normalization merges two spans, which happens after every operation.

Every operation that *moves or deletes* works in whole **grapheme clusters**
via `Intl.Segmenter`. The invariant: the model can represent a position inside
a cluster; no operation ever creates one.

### 5. React does not render inside the contenteditable

React owns the container `<div contentEditable>` and nothing below it. Contents
are written imperatively by `renderDoc()` in a `useLayoutEffect`. This is not
stylistic — React's correctness depends on being the sole author of its
subtree, and `contenteditable` exists to let something else write there.
Autocorrect, drag-drop, extensions and IME all mutate it without a preventable
event.

Do not add JSX children to the editable div.

## Conventions

**Commits.** Small and sequenced, so the history reads as a decomposition of
the problem. `feat(model):`, `feat(editor):`, `feat(ui):`, `chore:`, `docs:`.
Never squash the history into one commit.

**Tests.** Logic tests over model operations and selection math. No DOM
snapshots. Anything time-dependent takes the timestamp as an *input* rather
than reading `Date.now()` internally, so coalescing rules can be asserted at
`t=0` and `t=600` without fake timers.

**Types.** `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
and `noUnusedLocals`. Do not relax these — this codebase is almost entirely
array indexing, which is exactly where the off-by-one bugs live.

Marks are a discriminated union. Use `switch` on `mark.type` with a `never`
default so adding a mark type produces a compile error at every site that needs
updating, rather than a silent gap.

## Where the reasoning lives

- `ARCHITECTURE.md` — the data structure, the update loop, and how DOM events
  are reconciled with model updates
- `DECISIONS.md` — the rules for mark boundaries and history coalescing, the
  alternatives that were rejected, and what is deliberately out of scope

Every rule above has a non-obvious reason behind it. Read the relevant section
of those two documents before relaxing one.
