import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /* Steps hit the live API over HTTP, and that API hot-restarts on file
     * changes (node --watch) -- a request landing mid-restart can take
     * seconds. And since each step needs IDs from the previous ones, one
     * flaky timeout cascades into a dozen downstream failures. The 5s
     * default gets headroom so a failure means "the API is wrong", not
     * "the stack was busy". */
    testTimeout: 15_000,
  },
});
