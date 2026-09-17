import { describe, expect, it } from "vitest";
import { creditsToMicrocredits, microcreditsToCredits } from "./credits.ts";

describe("creditsToMicrocredits", () => {
  it("converts whole credits", () => {
    expect(creditsToMicrocredits({ credits: 42 })).toBe(42_000_000);
  });

  it("converts fractional credits exactly despite float error", () => {
    // 0.1 * 1e6 is 100000.00000000001 in IEEE 754; rounding recovers it.
    expect(creditsToMicrocredits({ credits: 0.1 })).toBe(100_000);
  });

  it("rounds to the nearest millionth", () => {
    expect(creditsToMicrocredits({ credits: 0.1234567 })).toBe(123_457);
    expect(creditsToMicrocredits({ credits: 0.1234564 })).toBe(123_456);
  });

  it("rounds half a millionth up", () => {
    expect(creditsToMicrocredits({ credits: 0.0000005 })).toBe(1);
  });

  it("keeps negative amounts negative", () => {
    expect(creditsToMicrocredits({ credits: -1.5 })).toBe(-1_500_000);
  });
});

describe("microcreditsToCredits", () => {
  it("converts whole credits", () => {
    expect(microcreditsToCredits({ microcredits: 42_000_000 })).toBe(42);
  });

  it("converts fractional credits", () => {
    expect(microcreditsToCredits({ microcredits: 123_456 })).toBe(0.123456);
  });

  it("round-trips with creditsToMicrocredits", () => {
    for (const microcredits of [1, 999_999, 1_000_000, 123_456_789]) {
      expect(
        creditsToMicrocredits({
          credits: microcreditsToCredits({ microcredits }),
        }),
      ).toBe(microcredits);
    }
  });
});
