import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts (whose root is src/runtime) so unit discovery stays in tests/unit
// and Playwright specs in tests/browser are never picked up by Vitest.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
})
