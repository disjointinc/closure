import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The test files share external state (the scratch Postgres database and
    // a throwaway Redis that gets FLUSHALL'd), so files must never run
    // concurrently.
    fileParallelism: false,
  },
});
