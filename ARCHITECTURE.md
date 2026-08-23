# Architecture

## The problem this solves

Set `contenteditable="true"` on a div and the browser gives you a text editor
for free. That is the trap. The browser will insert `<div>`, `<br>` or `<p>` on
Enter depending on which browser it is; produce `<b>` in one and
`<span style="font-weight:bold">` in another; and normalize the DOM out from
under whatever framework thinks it owns that subtree.

So the premise here is to take that control away. Input events are intercepted
and cancelled, the intent behind them is applied to a JSON model, and the DOM is
redrawn from that model. The DOM becomes a read-only picture of the data —
exactly like any other rendered view, except that the input device is a caret
rather than an `onChange`.

## The update loop

Everything hangs off one cycle:

```
beforeinput  →  preventDefault()  →  interpret inputType  →  pure operation
     →  normalize  →  new EditorState  →  useLayoutEffect  →  renderDoc
     →  writeSelection
```

Every `beforeinput` is cancelled, including the ones that aren't handled.
Silently ignoring an unsupported input is a defensible choice; letting the
browser handle it is not, because it would write DOM that the model has no
record of.

Selection travels the other way. A `selectionchange` listener reads the browser
selection back into the model.

That closes a loop which has to be broken somewhere: writing the selection fires
`selectionchange`, which reads it straight back. A flag cleared after the write
does not work — `selectionchange` is dispatched as a task and microtasks drain
first, so the flag is already clear when the echo arrives. It only appears to
work because writing an *unchanged* selection fires no event at all. So the
guard compares values instead: the last selection written is recorded, and an
event matching it is our own echo. The handler also returns the state unchanged
when the selection has not moved, since a fresh object for an unmoved caret
would re-render, re-write, and hand the loop another turn.

**Keyboard shortcuts for undo and redo do not travel this path.** The input spec
defines `historyUndo` and `historyRedo`, and they are handled — but nothing
depends on them, because a browser fires them only when *its own* undo stack has
something in it, and cancelling every input keeps that stack permanently empty.
So Ctrl+Z produces no input event at all and is caught on `keydown` instead. The
feature disappears from `beforeinput` precisely because the architecture works.

## The document model

```ts
Doc    →  Block[]  →  TextSpan[]  →  { text: string, marks: Mark[] }
```

A block is a paragraph. A span is a run of text sharing the same formatting —
text is cut at every formatting boundary, so `"Hello world"` with `"world"` bold
is two spans. Marks are a discriminated union: `bold`, `italic`, and `link`
carrying an `href`.

Every type is deeply readonly. Operations produce new documents rather than
mutating existing ones, which is what will make undo history cheap: an edited
document shares object references with its predecessor for every part that did
not change.

**Why spans rather than mark ranges.** The alternative is to keep the block's
text as one string and store formatting beside it as `{ start, end }`
intervals. That makes positions trivial — an offset *is* an index — and makes
mark toggling clean interval arithmetic. It loses on rendering: HTML cannot
express "one text node that goes bold halfway through", so a renderer would
have to recompute run boundaries on every pass, rebuilding the span structure
from scratch each time. And the position advantage is smaller than it looks,
because the DOM contains the split runs regardless, so mapping a browser cursor
back to the model still needs the same walk — just relocated into the layer that
is hardest to test.

## Normalization

Cutting text at formatting boundaries means one visible document can be stored
many ways. Bold `"hello"` is a single span if you typed it and bolded it, or two
spans if you bolded `"he"` and `"llo"` separately. Both render identically.

That matters because every test has the shape *"after doing X, the document
should equal Y"* — and without a canonical form, two documents that are
indistinguishable on screen compare unequal. The only remaining way to compare
would be rendered output, which is precisely the DOM-snapshot testing this
project is meant to avoid.

So normalization is the function that collapses all equivalent shapes into one.
After it runs, **"same document" and "deep-equal object" mean the same thing**,
and the entire test suite rests on that equivalence.

It guarantees:

1. No span has empty text — *unless it is the only span in its block*
2. No two adjacent spans have equal marks
3. Marks are sorted by type and contain no duplicates
4. At most one link mark per span
5. Every block has at least one span
6. The document has at least one block

Rule 1's exception is load-bearing rather than untidy. Rules 1 and 5 cannot both
hold without exception: a block whose text has all been deleted either holds
zero spans (breaking 5) or one empty span (breaking 1). Keeping rule 5 whole
means position resolution and every insertion path always have a span to work
with, so none of them need a "but what if there is nothing here" branch. The
tidier-sounding invariant would push that branch out into every consumer
instead.

Rule 4 is not automatic. Two link marks with different `href`s are not equal, so
ordinary deduplication would leave both, and rendering would have no answer for
which anchor wraps the text.

Normalization is idempotent, and that is asserted directly.

## Positions and selection

A position is `{ blockId, offset }` — a block, plus a count of UTF-16 code units
into that block's flattened text.

**Not a path.** `{ blockId, spanIndex, offset }` mirrors the storage and is
nearly what the browser hands you, but it dangles: when the user un-bolds a word
and normalization merges the two adjacent spans, a position pointing at span 1
now addresses a span that no longer exists. A character count is unaffected,
because merging spans never moves a character. Since re-segmenting spans is
normalization's entire job and normalization runs after every operation, paths
would need remapping constantly.

**Block ID, not block index** — same argument one level up. Inserting a
paragraph shifts every index below it; IDs don't move.

**Anchor and focus, not start and end.** Direction is information: shift-arrow
extends from the focus. Operations don't care, so they sort into an ordered
range at the point of use.

**Offsets count code units; operations move in grapheme clusters.** Code units
match both `String.length` and the offsets the DOM returns, so no conversion
layer sits between model and browser. But a family emoji is eleven code units,
seven code points, and one thing a human sees — deleting a code point turns a
four-person emoji into a three-person one. So anything that moves or deletes
goes through `Intl.Segmenter`. The invariant: a position inside a grapheme
cluster is representable; no operation creates one.

## Marks

Toggling a mark on a range that is only partly marked **adds it to all of the
range**; removal happens only when every character already carries it. The
toolbar's three states are the same rule seen from the other side, computed by
the same function, so the button's appearance predicts its effect.

What a character typed at a formatting boundary inherits falls out of the
position model rather than being a second rule. Resolving an offset already
returns the span that *ends* there rather than the one that begins, so a
position and the formatting it inherits agree by construction.

Pressing a format button with nothing selected changes no document at all — it
records an intention, applied to the next character typed and discarded when the
caret moves. That intention is a complete mark set rather than a list of marks
to add, because pressing Ctrl+B just after a bold word has to be able to mean
*not* bold, contradicting what would otherwise be inherited.

Links are the exception to almost all of this: they carry a target, so applying
one replaces rather than toggles, and removal is a separate operation. See
`DECISIONS.md` for the full rules.

## History

Entries are **complete snapshots of the document and the selection**, not
inverse operations. The memory objection does not apply, because the operations
are immutable and share structure: editing one block produces a document that
reuses the same object references for every block that did not change, so a
snapshot costs one new block rather than one new document.

The selection lives *inside* the snapshot rather than beside it, so undo
restores the caret to where it was before an edit rather than where the edit
left it, and the two cannot drift apart.

Consecutive edits merge into one entry when they are the same kind, in the same
block, contiguous, within half a second, and not across whitespace — otherwise
typing `hello` would take five presses of Ctrl+Z. The window is measured from
the last keystroke rather than the start of the run, so continuous typing
extends indefinitely and any pause ends it.

The timestamp is an **input** to that rule rather than read from a clock inside
it, which is what lets a test hand it `t=0` and `t=600` and assert the run broke
without fake timers.

## Rendering: React owns the container, not its contents

React keeps a virtual DOM — its own copy of what it believes the real DOM looks
like — and its correctness depends on being the **sole author** of that subtree.
A `contenteditable` region exists for something else to write there.

Cancelling `beforeinput` covers most of that, but not all of it: spellcheck
autocorrect, drag-and-drop, browser extensions, and IME composition all mutate
the DOM without a preventable event. When that happens React's picture is stale,
and the next reconciliation either throws on `removeChild` or silently discards
the user's text. This is the most common class of bug in React-based editors.

So React renders the container and nothing inside it:

```tsx
<div contentEditable suppressContentEditableWarning ref={containerRef} />
```

No JSX children, therefore no virtual DOM for the contents, therefore nothing
that can go stale. A `useLayoutEffect` writes the contents imperatively and
restores the caret — after the DOM updates but before the browser paints, so the
caret never visibly flickers.

The trade is roughly a hundred and fifty lines of hand-written reconciliation,
with a far narrower job than React's: one container, one element type per mark,
keyed by block ID. What it buys is control over exactly when each DOM node is
replaced — and replacing the text node the caret sits in is what loses the
caret.

## Layering

```
src/model/    pure data and pure functions. Never imports a DOM API.
src/editor/   the adapter: reads plain values out of DOM nodes, writes
              DOM from plain values, and owns the event listeners.
```

The test suite runs in a Node environment specifically so that boundary is
structural rather than aspirational — an import of `document` under `src/model/`
fails the suite immediately instead of passing quietly under jsdom.

This is also what makes selection mapping testable. The *math* —
`resolvePosition`, `flattenOffset`, `orderRange` — takes plain data and returns
plain data. The DOM adapter pulls values out of nodes and calls into it. So the
interesting half of the bidirectional mapping is unit-testable without a
browser.

The same trick is applied one layer out. Deciding what `deleteWordBackward`
means is a pure question, so the input mapping takes a plain
`{ inputType, data, clipboardText }` rather than an `InputEvent`, and the
clipboard is read at the edge where the DOM types live. A real event satisfies
the keyboard shape structurally, so no adapter is needed for shortcuts either.

### What is not covered by tests, and why

`renderDoc` and the DOM selection adapter — about 300 lines — are verified by
hand in a browser rather than automatically.

This is a deliberate line rather than an omission. jsdom would exercise the
structural parts (element reuse by block id, the `data-offset` walk, empty-block
handling) but its `Selection` implementation is partial, so a test could pass
while the caret lands in the wrong place. The behaviour that matters most in
that layer is exactly the behaviour jsdom cannot confirm.

Two bugs found during development make the point in both directions. A typed
space not appearing was invisible to every model test, because `textContent`
contains the space whether or not it renders — only measuring the laid-out caret
position showed it. And coalescing silently never firing was invisible in the
browser, because undo still worked, just one character at a time; a unit test
caught it. Neither method would have found both.

## Why Vite rather than Next.js

An editor built on `contenteditable` is a client-only, keystroke-driven,
DOM-coupled surface. Next.js would contribute one `'use client'` boundary and
then nothing else, because the rendering-strategy decisions it exists to enable
— server components, streaming, ISR — have nothing to act on here. There is no
data to fetch on the server and no page to prerender.

The point at which that changes is worth naming: if the editor loaded a stored
document, server-rendering the initial content and streaming the shell would be
real wins, and the framework would start earning its place.

## Out of scope: IME

Input Method Editors — used for Japanese, Chinese and Korean input, and also
by Android soft keyboards for ordinary Latin typing and swipe input — break the
cancel-and-reapply model, because during composition **the browser must own the
DOM**. `insertCompositionText` is not cancelable; `preventDefault()` on it does
nothing. The browser needs to render candidate text, underlines, and
in-progress conversions that the model knows nothing about.

The approach, if this were production:

1. On `compositionstart`, set a flag that **suspends reconciliation**. The
   render effect returns early while it is set, so the editor stops redrawing
   from the model and lets the browser mutate the block freely.
2. Let composition run. The DOM and the model diverge, deliberately, for its
   duration.
3. On `compositionend`, read the affected block's `textContent`, diff it against
   what the model says that block contains, and apply the difference as an
   ordinary insertion or replacement.
4. Resume reconciliation and restore the caret from the model.

The container-only rendering choice pays off precisely here: since React holds
no virtual DOM for the editable, suspending *our* reconciliation is sufficient
to hand the subtree over. Under a model where React renders the spans, React's
own rendering would also have to be suspended — fighting the framework at the
moment things are most fragile.

The hard part left over is that a composition spanning a formatting boundary
has no clean answer, since the browser flattens the region it is composing in.
Most production editors constrain composition to a single span and accept the
limitation.

## Out of scope: HTML paste

Pasted `text/html` is arbitrary markup from an arbitrary source — Word emits
nested `<span>` soup with inline styles, Google Docs emits its own internal
markup, and both carry structure this model cannot represent.

The approach, if this were production:

1. Parse the clipboard's `text/html` with `DOMParser` into a **detached**
   document. Not `innerHTML` on a live node, which would execute scripts and
   fire resource loads.
2. Walk that tree with an **allowlist**, mapping tags to marks: `<b>`/`<strong>`
   to bold, `<i>`/`<em>` to italic, `<a href>` to link, `<p>`/`<div>` to block
   boundaries. Everything else is discarded, keeping its text content.
3. Also inspect inline styles for the cases that carry formatting without
   semantic tags — `font-weight: 700` on a `<span>` is how several editors
   express bold.
4. Emit the result as model operations, then normalize.

The reason this is a whitelist walk over a parsed tree rather than sanitisation
of an HTML string: the model can only represent what the walk produces, so
anything unrecognised is dropped by construction rather than by pattern
matching. There is no "sanitised HTML" intermediate that could carry something
unexpected through.

Currently a paste inserts the clipboard's plain text only, which is lossy but
never wrong.
