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
      router: {
        generatedRouteTree: "../routeTree.gen.ts",
      },
    }),
    // React's Vite plugin must come after Tanstack Start's Vite plugin
    viteReact(),
  ],
});
