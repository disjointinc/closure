import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /* Integration tests run global scans (reconcile, checkpoint, scheduler)
     * over the shared database, so they take seconds under parallel load;
     * the 5s default flakes them. 15s keeps a failure meaning "the code is
     * wrong", not "the database was busy". */
    testTimeout: 15_000,
  },
});
