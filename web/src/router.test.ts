import { describe, expect, it } from "vitest";
import { getRouter } from "./router.tsx";

describe("router", () => {
  it("constructs the router server-side (the SSR path)", () => {
    const router = getRouter();
    expect(router).toBeDefined();
    expect(router.routesById["/"]).toBeDefined();
  });
});
