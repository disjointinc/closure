/**
 * handler.test.ts -- drift protection: every route under /v0 must be
 * documented in the generated OpenAPI doc. The doc is built from the
 * zod-openapi route definitions, so an undocumented route fails CI.
 * Runs offline: this file never touches the db (postgres-js connects lazily).
 */
import { describe, expect, it } from "vitest";
import app, { getApiDoc } from "./handler.ts";

/** Hono :param syntax -> OpenAPI {param} syntax; normalize trailing slashes. */
function openApiPath(path: string): string {
  const converted = path.replace(/:([A-Za-z0-9]+)/g, "{$1}");
  return converted.length > 1 ? converted.replace(/\/$/, "") : converted;
}

describe("openapi coverage", () => {
  it("every /v0 route is documented", () => {
    const doc = getApiDoc();
    const documented = new Set(
      Object.entries(doc.paths ?? {}).flatMap(([path, operations]) =>
        Object.keys(operations).map(
          (method) => `${method.toUpperCase()} ${openApiPath(path)}`,
        ),
      ),
    );
    // Method "ALL" entries are middleware, not routes (the tenant c.set shim).
    const undocumented = app.routes
      .filter((route) => route.method !== "ALL")
      .filter((route) => route.path.startsWith("/v0/"))
      .map((route) => `${route.method} ${openApiPath(route.path)}`)
      .filter((route) => !documented.has(route));
    expect(undocumented).toEqual([]);
  });
});
