import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /* The model layer must never touch the DOM. Running tests in a node
       environment makes that structural rather than aspirational: importing a
       browser API under src/model/ fails the suite immediately, instead of
       passing quietly under jsdom.

       The brief asks for "logic tests, not DOM snapshots" — this is the
       enforcement of that, not just the intent. */
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
