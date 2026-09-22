/**
 * schemas/plan.test.ts -- unit tests for plan meter write-time validation:
 * top-up pricing tiers and credit pack sizes must fit under the meter's
 * limit (checkPlanMeter).
 */
import { describe, expect, it } from "vitest";
import { planMeterSchema } from "./plan.ts";

const price = {
  cycleId: "cycle_abcdefghijklmnopqrst",
  amounts: [{ currency: "USD", unit: "cents", value: 500 }],
};

const base = {
  meterId: "meter_abcdefghijklmnopqrst",
  defaultMicrocredits: 50_000_000,
  limitMicrocredits: 100_000_000,
  reset: null,
  rollovers: null,
  topUpPricesPerCredit: null,
  topUpCreditPackSizes: { static: [1_000_000, 100_000_000], dynamic: null },
};

describe("plan meter static pack size validation", () => {
  it("accepts static packs <= limitMicrocredits", () => {
    const result = planMeterSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts any static pack when limitMicrocredits is null", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      limitMicrocredits: null,
      topUpCreditPackSizes: { static: [999_000_000], dynamic: null },
    });
    expect(result.success).toBe(true);
  });

  it("accepts null static packs", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpCreditPackSizes: { static: null, dynamic: null },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a static pack > limitMicrocredits", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpCreditPackSizes: { static: [100_000_001], dynamic: null },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("limitMicrocredits");
      expect(result.error.issues[0].path).toEqual([
        "topUpCreditPackSizes",
        "static",
        0,
      ]);
    }
  });
});

describe("plan meter top-up pricing tier validation", () => {
  it("accepts tiers with unique pack-size thresholds <= limitMicrocredits", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpPricesPerCredit: [
        { startingAtPackSizeMicrocredits: 0, prices: [price] },
        { startingAtPackSizeMicrocredits: 100_000_000, prices: [price] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts any tier threshold when limitMicrocredits is null", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      limitMicrocredits: null,
      topUpPricesPerCredit: [
        { startingAtPackSizeMicrocredits: 999_000_000, prices: [price] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate startingAtPackSizeMicrocredits values", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpPricesPerCredit: [
        { startingAtPackSizeMicrocredits: 1_000_000, prices: [price] },
        { startingAtPackSizeMicrocredits: 1_000_000, prices: [price] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("unique");
    }
  });

  it("rejects a tier startingAtPackSizeMicrocredits > limitMicrocredits", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpPricesPerCredit: [
        { startingAtPackSizeMicrocredits: 100_000_001, prices: [price] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("limitMicrocredits");
      expect(result.error.issues[0].path).toEqual([
        "topUpPricesPerCredit",
        0,
        "startingAtPackSizeMicrocredits",
      ]);
    }
  });
});

describe("plan meter dynamic pack size validation", () => {
  const dynamic = {
    packSizeIntervalMicrocredits: 1_000_000,
    minimumPackSizeMicrocredits: 1_000_000,
    maximumPackSizeMicrocredits: 100_000_000,
  };

  it("accepts a maximumPackSizeMicrocredits <= limitMicrocredits", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpCreditPackSizes: { static: null, dynamic },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a maximumPackSizeMicrocredits > limitMicrocredits", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpCreditPackSizes: {
        static: null,
        dynamic: { ...dynamic, maximumPackSizeMicrocredits: 100_000_001 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("limitMicrocredits");
      expect(result.error.issues[0].path).toEqual([
        "topUpCreditPackSizes",
        "dynamic",
        "maximumPackSizeMicrocredits",
      ]);
    }
  });

  it("rejects a maximumPackSizeMicrocredits <= minimumPackSizeMicrocredits", () => {
    const result = planMeterSchema.safeParse({
      ...base,
      topUpCreditPackSizes: {
        static: null,
        dynamic: { ...dynamic, maximumPackSizeMicrocredits: 1_000_000 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "maximumPackSizeMicrocredits must be greater than minimumPackSizeMicrocredits",
      );
    }
  });
});
