# Rich-Text Editor Core

A predictable rich-text editor where the document model is the single source of
truth and the `contenteditable` DOM is purely a projection of it.

## Running it

This repo uses **pnpm**. If you don't have it: `npm install -g pnpm`.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

```bash
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest, node environment
```

Node 24 (see `.nvmrc`); anything from Node 20 up will work.

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — the document model, the update
  loop, and how DOM events are reconciled with model updates
- **[DECISIONS.md](./DECISIONS.md)** — the rules for mark boundaries and
  history coalescing, and what is deliberately out of scope
