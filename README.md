# Rich-Text Editor Core

A rich-text editor where a JSON document model is the single source of truth and
the `contenteditable` DOM is purely a projection of it.

Bold, italic, links, undo and redo. No editor library — the document model,
the operations, the selection mapping and the history stack are all written
here.

**[Live demo →](https://editor-six-beryl.vercel.app)**

## Running it

This repo uses **pnpm**. If you don't have it: `npm install -g pnpm`.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

```bash
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest, node environment
pnpm build
```

Node 24 (see `.nvmrc`); anything from Node 20 up will work.

## What it does

| | |
|---|---|
| **Type** | every keystroke is intercepted, applied to the model, and re-rendered from it |
| **Bold / Italic** | `Ctrl`/`Cmd` + `B` and `I`, or the toolbar. Buttons show on, off, or **mixed** |
| **Links** | select text, click Link. Put the caret in a link to edit it — the URL is prefilled. `Ctrl`/`Cmd` + click opens it |
| **Enter** | splits the block; backspace at the start of a block merges it upwards |
| **Undo / Redo** | `Ctrl`/`Cmd` + `Z`, and `Shift` for redo. Grouped by word rather than by keystroke |

Deletion works in whole grapheme clusters, so one backspace removes an entire
emoji rather than half of one, and `Ctrl`/`Alt` + backspace uses real word
boundaries rather than scanning for spaces.

## How it works

The browser never writes into the document. Every `beforeinput` event is
cancelled, interpreted against the model, and the DOM redrawn from the result:

```
keystroke → preventDefault() → operation → normalize
          → re-render → restore the caret
```

React renders the editable container and nothing inside it, so a mutation the
browser makes on its own has no virtual DOM to fall out of step with.

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — the document model, the update
  loop, how DOM events are reconciled with model updates, and how IME and rich
  paste would be approached
- **[DECISIONS.md](./DECISIONS.md)** — the rules, each with the alternatives
  that were rejected and why

## Layout

```
src/model/     pure data and pure functions; never imports a DOM API
src/editor/    the adapter — DOM in, DOM out, and the event listeners
```

Tests run in a Node environment, so an accidental `document` reference inside
`src/model/` fails the suite rather than passing quietly.

## Deliberately out of scope

IME composition, rich HTML paste (pasting inserts plain text), soft line
breaks, lists and headings, and collaborative editing. Each is covered in
`DECISIONS.md` with what it would cost to add.

The document is kept in local storage, so it survives a refresh — but that is a
demonstration of the JSON round trip rather than a storage layer. Undo history
is not kept.
