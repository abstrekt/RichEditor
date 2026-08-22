# Decisions

Rules this editor follows, and why. Where a rule had a defensible alternative,
the alternative is named along with what it would have cost — a decision without
its rejected options is just an assertion.

---

## Document representation

**Text is cut at every formatting boundary.** A block holds a list of spans,
each carrying its own marks. `"Hello world"` with `"world"` bold is two spans.

*Alternative:* keep the block's text as one string and store formatting beside
it as `{ start, end }` intervals. Positions become trivial and mark toggling
becomes clean interval arithmetic — but rendering has to recompute run
boundaries on every pass, and the position advantage largely evaporates because
the DOM holds the split runs regardless.

**Marks are a discriminated union held in an array**, not a flags object.

*Alternative:* `{ bold?: true, italic?: true, link?: string }`. Equality would
be three field comparisons instead of a canonicalisation step, and duplicates
would be impossible by construction. Rejected because marks are handled in four
separate places — rendering, toggling, comparison, and validation — and a
`switch` with a `never` default makes the compiler enumerate every site that
needs updating when a mark type is added. With a flags object those gaps are
silent.

---

## Normalization invariants

After normalization:

1. **No span has empty text** — unless it is the only span in its block
2. **No two adjacent spans have equal marks**
3. **Marks are sorted by type and contain no duplicates**
4. **At most one link mark per span**
5. **Every block has at least one span**
6. **The document has at least one block**

Normalization is idempotent, and that is asserted directly.

### Why rule 1 has an exception

Rules 1 and 5 cannot both hold without one. A block whose text has all been
deleted must either hold zero spans — breaking rule 5 — or one empty span,
breaking rule 1. There is no third arrangement.

Rule 5 is the one kept whole, because it is the one downstream code leans on:
position resolution and every insertion path always have a span to point at, so
none of them need a "but what if there is nothing here" branch. Zero spans reads
as the tidier invariant and pushes that branch out into every consumer instead.

**The general principle:** prefer the invariant that makes downstream code
unconditional over the one that reads best in isolation.

That empty span also has a `marks` slot, which is where formatting survives when
a whole bold paragraph is deleted and the user keeps typing.

### Why rule 4 needs stating

It is not automatic. Two link marks with different `href`s are not equal, so
ordinary deduplication leaves both — and rendering has no answer for which
anchor wraps the text. Applying a link to a range replaces any links already
there; removing a link from a range containing several removes all of them.

### Where normalization runs

Once, in a single `apply()` that every user action passes through — never inside
individual operations.

*Alternative:* have each operation end with `return normalize(result)`. The type
`Doc` would then always mean canonical, with no module discipline to maintain.
Rejected because normalization is not the only thing that must happen exactly
once per user action — remapping the selection and pushing to history have the
same shape, and they are going into a shared function regardless. Splitting them
across two places would create two competing definitions of "one user action".

Raw operations are therefore not exported; the module's public surface is
`apply`.

---

## Positions

**A position is `{ blockId, offset }`** — a block, and a count of UTF-16 code
units into that block's flattened text.

*Alternative:* a path, `{ blockId, spanIndex, offset }`. It mirrors the storage
and is close to what the browser reports. Rejected because it dangles: when a
word is un-bolded and normalization merges the two adjacent spans, a position
pointing at span 1 addresses a span that no longer exists. Re-segmenting spans
is normalization's entire job and normalization runs after every operation, so
paths would need constant remapping.

**Block ID, not block index.** Inserting a paragraph shifts every index below
it. IDs don't move.

**Selections carry `anchor` and `focus`, not `start` and `end`.** Direction is
information — shift-arrow extends from the focus. Operations sort into an
ordered range at the point of use.

**A position falling exactly on a span boundary resolves to the end of the
earlier span**, not the start of the later one — the same backward bias the
affinity rule uses, so a position and the formatting it inherits never disagree
about which side of a boundary they are on.

---

## Text segmentation

**Offsets count UTF-16 code units. Operations move in grapheme clusters.**

A family emoji is eleven code units, seven code points, and one thing a human
sees. Deleting a code unit produces an invalid string; deleting a code point
turns a four-person emoji into a three-person one — the user pressed Backspace
once and their family lost a member.

Code units are used for offsets because they match both `String.length` and the
offsets the DOM returns, so no conversion layer sits between the model and the
browser. Anything that moves or deletes goes through `Intl.Segmenter` instead.

**The invariant:** a position inside a grapheme cluster is representable; no
operation ever creates one.

*Alternative:* count grapheme clusters in the offset itself. Semantically
cleaner — offset *n* means the *n*th thing a human sees — but it forces a
bidirectional conversion on every selection read and write, and any bug in that
conversion misplaces the caret in a way that is miserable to debug.

**Word-wise deletion uses `Intl.Segmenter` with word granularity**, not a scan
back to the previous space. Japanese and Thai don't put spaces between words, so
a whitespace scan deletes an entire sentence on one keystroke.

---

## Non-deterministic values are inputs

New block IDs and timestamps are **fields on the operation object**, not values
generated inside operations.

`crypto.randomUUID()` inside a `splitBlock` would make it impure — the same
inputs producing a different document every call — and tests would have to strip
IDs before comparing. Document deep-equality is the property the entire test
suite rests on, so weakening it to save a parameter is a bad trade. The same
reasoning applies to the timestamp the history coalescing rules need.

---

## Mark boundaries

### Toggling a range that is already partly marked

**If every character in the range carries the mark, it is removed from all of
them. Otherwise it is added to all of them.**

So selecting text where only one word is bold and pressing Ctrl+B makes the
whole selection bold. Pressing it again — now that everything carries it —
removes it.

*Alternative:* invert each character independently, so marked characters lose
the mark and unmarked ones gain it. Internally consistent and useless: half the
selection would lose its formatting on a keystroke the user meant as "make this
bold".

*Alternative:* remove unless nothing carries the mark. Defensible, and some
older editors behaved this way on the logic that the button clears formatting
whenever any is present. Rejected because it surprises in the common case:
select a long plain sentence containing one bold word, press Bold expecting
bold, get nothing.

The reason underneath is about intent. Pressing a format button states "I want
this". Only when applying would be a no-op does pressing it plausibly mean "I
want it gone".

### The toolbar shows the same rule from the other side

| Condition | Button shows | Pressing it |
|---|---|---|
| every character carries the mark | **active** | removes |
| some do | **mixed** | adds |
| none do | **inactive** | adds |

The button's appearance predicts its effect: lit means pressing turns it off,
anything less than lit means pressing turns it on. One function answers both
questions, so they cannot drift apart.

### What a character typed at a boundary inherits

An offset can sit at both the end of one run and the start of the next. In
`Hello world` with `world` bold, offset 6 is simultaneously the end of the plain
run and the start of the bold one. Typing there could reasonably produce either.

**Backward affinity: a character inherits the formatting of the character to its
left.** At offset 0 there is nothing to the left, so it falls forward to the
character on the right.

The case that decides it is not the boundary but the *end of a run*. Having just
typed a bold word, carrying on typing should stay bold — that is what any editor
does and what anyone expects. Backward affinity gives that, and it happens to
give the right answer at a boundary too: clicking just before a bold word and
typing produces plain text, which is what deliberately placing the caret there
suggests you wanted.

This falls out of the position model rather than being a second rule bolted on.
Resolving an offset already returns the span that *ends* there rather than the
one that begins, so a position and the formatting it inherits agree by
construction.

*What production would do instead:* track affinity as selection state, set by
the direction the caret arrived from — right-arrow onto a boundary means left
affinity, left-arrow onto it means right affinity. More faithful to intent, and
it is what makes arrow-keying through mixed formatting feel correct rather than
sticky. The browser's Selection API does not expose affinity at all, so it would
have to be maintained by hand through every operation, and no event reports
which direction a click arrived from.

### Pressing a format button with nothing selected

There is no text to format yet, so the toggle changes no document at all. It
records an intention, applied to the next character typed and discarded if the
caret moves.

**That intention is a complete mark set, not a list of marks to add.** Pressing
Ctrl+B with the caret just after a bold word has to be able to mean *not* bold —
contradicting what affinity would otherwise inherit. A list of additions cannot
express a removal, so the precedence is:

```
1. pending marks      explicit toggle; wins
2. backward affinity  formatting of the character to the left
3. forward affinity   only reached at offset 0
```

### Marks compose; they do not replace

Bolding italic text produces text that is both. The exception is links, which
carry a target: applying a link to a range replaces any link already there,
because a span cannot render as two anchors at once.

---

## Deliberately out of scope

Each of these is a scope cut, not an oversight. `ARCHITECTURE.md` describes how
IME and paste would be approached in production.

- **IME composition.** `insertCompositionText` is not cancelable, so the
  cancel-and-reapply model cannot cover it. Would need reconciliation suspended
  between `compositionstart` and `compositionend`, then a diff of the block's
  text back into the model.
- **Rich HTML paste.** Pasting inserts the clipboard's plain text. Lossy, never
  wrong.
- **Soft line breaks.** Shift+Enter is treated as a paragraph split. A real soft
  break would be the model's first inline node that isn't text — `Span` becomes
  a union, `blockText` has to decide what a break contributes, normalization
  gains non-merge rules, and affinity needs an answer for a character typed
  after one. Roughly sixty lines across six functions, to serve one keystroke.
  The cost of the simplification is that an address or a stanza of poetry
  becomes several paragraphs rather than one semantic unit.
- **Nested blocks, lists, headings, tables, images.** The block type is
  `'paragraph'` and nothing else.
- **Collaborative editing.** Snapshots would give way to inverse operations, and
  the span model would likely give way to intervals, which survive concurrent
  remote edits far better than a list of split runs.
- **Persistence.** The document lives in memory and is lost on refresh.
