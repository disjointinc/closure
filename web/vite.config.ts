import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { config } from "../config.ts";

export default defineConfig({
  server: {
    host: config.web.host,
    port: config.web.port,
    strictPort: true,
  },
  preview: {
    host: config.web.host,
    port: config.web.port,
    strictPort: true,
  },
  plugins: [
    tanstackStart({
      // SPA mode: all data fetching happens browser-side (the console talks
      // to the API on localhost), so there is nothing to render server-side.
      spa: { enabled: true },
      router: {
        generatedRouteTree: "../routeTree.gen.ts",
      },
    }),
    // React's Vite plugin must come after Tanstack Start's Vite plugin
    viteReact(),
  ],
});
