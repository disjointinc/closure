import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the TanStack Start plugin there is for
// dev/build and must not load in tests. Node environment -- no DOM needed
// for the tests here (getRouter is the same code SSR runs server-side).
export default defineConfig({
  test: {
    environment: "node",
  },
});
