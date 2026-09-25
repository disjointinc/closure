/**
 * quickstart.test.ts -- runs every call in docs/guide/quickstart.mdx, in
 * order, against a locally running stack (docker compose up), asserting the
 * documented behavior at each step.
 *
 * Every resource created here is marked with TEST_SUITE_RESOURCE_MARKER so
 * the API's garbage collector (api/garbage-collection/test-suite-resources.ts)
 * can hard-delete it later; the marker contract lives in that file. Garbage
 * collection is on by default outside production (config.ts).
 */
import { afterAll, describe, expect, it } from "vitest";
import { redis } from "../../api/cache/index.ts";
import { db } from "../../api/db/index.ts";
import {
  collectTestSuiteResources,
  createMarkedResource,
} from "../../api/garbage-collection/test-suite-resources.ts";

const API_URL = `http://localhost:${process.env.CLOSURE_API_PORT ?? "3216"}`;

/* Mirrors api/garbage-collection/test-suite-resources.ts. */
const TEST_SUITE_RESOURCE_MARKER = "resource-created-by-test-suite";
const SUITE = "quickstart-test";
const RUN_ID = `${Date.now()}`;

afterAll(async () => {
  /* Self-collect this suite's marked resources: every suite collects only
   * its own, so this never touches another suite's in-flight resources.
   * (The collect lives in the api package; it runs against the same
   * database the stack serves.) */
  await collectTestSuiteResources({ suite: SUITE });
  redis.quit();
  await db.$client.end();
});

interface ProductLine {
  productLineId: string;
}
interface Feature {
  featureId: string;
}
interface Meter {
  meterId: string;
}
interface Cycle {
  cycleId: string;
}
interface TeamMember {
  teamMemberId: string;
}
interface Plan {
  planId: string;
}
interface Tenant {
  tenantId: string;
}
interface Assignment {
  assignmentId: string;
}
interface FeatureEntitlement {
  featureId: string;
  setTo: boolean | string[];
}
interface MeterEntitlement {
  meterId: string;
  defaultCredits: number;
  limitCredits: number | null;
}
interface MeterBalance {
  balanceCredits: number | null;
}
interface MeterEvent {
  status: "succeeded" | "insufficient_balance" | "unexpected_error";
  balanceCredits: number | null;
}

const request = async <T>({
  body,
  method,
  path,
}: {
  body?: unknown;
  method: "GET" | "POST";
  path: string;
}): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers:
      body === undefined
        ? undefined
        : {
            "content-type": "application/json",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
};

const post = <T>({ body, path }: { body: unknown; path: string }) =>
  request<T>({ body, method: "POST", path });
const get = <T>({ path }: { path: string }) =>
  request<T>({ method: "GET", path });

/* IDs captured as the suite progresses, exactly like the placeholders in
 * quickstart.mdx ("<product line ID from above>", etc). */
const created: {
  productLineId?: string;
  slackFeatureId?: string;
  crmFeatureId?: string;
  meterId?: string;
  monthlyCycleId?: string;
  annualCycleId?: string;
  teamMemberId?: string;
  planId?: string;
  tenantId?: string;
} = {};

describe("quickstart", () => {
  it("creates a product line", async () => {
    const { status, body } = await post<ProductLine>({
      path: "/v0/product-line",
      body: {
        name: createMarkedResource({
          name: "Default product line",
          suite: SUITE,
        }),
        description: "The product line where all our plans live",
        forceBillingCycleSynchronizationWithProductLineIds: [],
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.productLineId).toMatch(/^product_line_[a-z0-9]{20}$/);
    created.productLineId = body.productLineId;
  });

  it("creates a boolean feature", async () => {
    const { status, body } = await post<Feature>({
      path: "/v0/feature",
      body: {
        productLineId: created.productLineId,
        name: createMarkedResource({ name: "Slack alerts", suite: SUITE }),
        description: "Send the tenant alerts in Slack",
        options: null,
        applicableTaxTypeIds: [],
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.featureId).toMatch(/^feature_[a-z0-9]{20}$/);
    created.slackFeatureId = body.featureId;
  });

  it("creates a select feature", async () => {
    const { status, body } = await post<Feature>({
      path: "/v0/feature",
      body: {
        productLineId: created.productLineId,
        name: createMarkedResource({ name: "CRM", suite: SUITE }),
        description: "CRMs that can be connected",
        options: [
          { name: "hubspot", description: null },
          { name: "salesforce", description: null },
          { name: "attio", description: null },
          { name: "dynamics365", description: null },
        ],
        applicableTaxTypeIds: [],
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.featureId).toMatch(/^feature_[a-z0-9]{20}$/);
    created.crmFeatureId = body.featureId;
  });

  it("creates a meter", async () => {
    const { status, body } = await post<Meter>({
      path: "/v0/meter",
      body: {
        productLineIds: [created.productLineId],
        name: createMarkedResource({ name: "Seats", suite: SUITE }),
        description: "The number of users on a tenant",
        applicableTaxTypeIds: [],
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.meterId).toMatch(/^meter_[a-z0-9]{20}$/);
    created.meterId = body.meterId;
  });

  it("creates a monthly cycle, charged upfront", async () => {
    const { status, body } = await post<Cycle>({
      path: "/v0/cycle",
      body: {
        charged: "upfront",
        cycleLength: { days: null, months: 1 },
        defaultDiscountPercentage: null,
        name: createMarkedResource({ name: "Monthly", suite: SUITE }),
        description: "Monthly billing cycle",
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.cycleId).toMatch(/^cycle_[a-z0-9]{20}$/);
    created.monthlyCycleId = body.cycleId;
  });

  it("creates an annual cycle, charged in arrears", async () => {
    const { status, body } = await post<Cycle>({
      path: "/v0/cycle",
      body: {
        charged: "arrears",
        cycleLength: { days: null, months: 12 },
        creditPeriod: { days: 30, months: null },
        gracePeriod: { days: 5, months: null },
        defaultDiscountPercentage: 20,
        name: createMarkedResource({ name: "Annual", suite: SUITE }),
        description: "Annual billing cycle",
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.cycleId).toMatch(/^cycle_[a-z0-9]{20}$/);
    created.annualCycleId = body.cycleId;
  });

  it("creates a team member", async () => {
    const { status, body } = await post<TeamMember>({
      path: "/v0/team-member",
      body: {
        /* The email carries the marker only for per-run uniqueness (email
         * has a unique constraint); garbage collection matches on name. */
        email: `${TEST_SUITE_RESOURCE_MARKER}-${SUITE}-${RUN_ID}@example.com`,
        name: createMarkedResource({ name: "Colin", suite: SUITE }),
        profilePictureUrl: null,
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.teamMemberId).toMatch(/^team_member_[a-z0-9]{16}$/);
    created.teamMemberId = body.teamMemberId;
  });

  it("creates a plan", async () => {
    const { status, body } = await post<Plan>({
      path: "/v0/plan",
      body: {
        productLineId: created.productLineId,
        derivedFromPlanId: null,
        name: createMarkedResource({ name: "Starter", suite: SUITE }),
        description: "The starter plan",
        prices: [
          {
            cycleId: created.monthlyCycleId,
            amounts: [
              { currency: "USD", unit: "cents", value: 2900 },
              { currency: "EUR", unit: "cents", value: 2500 },
            ],
          },
          {
            cycleId: created.annualCycleId,
            amounts: [
              { currency: "USD", unit: "cents", value: 290000 },
              { currency: "EUR", unit: "cents", value: 250000 },
            ],
          },
        ],
        features: [
          { featureId: created.slackFeatureId, setTo: false },
          { featureId: created.crmFeatureId, setTo: ["hubspot", "attio"] },
        ],
        meters: [
          {
            meterId: created.meterId,
            defaultCredits: 10,
            limitCredits: 30,
            reset: "billing_cycle_end",
            rollovers: 1,
            topUpPricesPerCredit: [
              {
                startingAtPackSizeCredits: 0,
                prices: [
                  {
                    cycleId: created.monthlyCycleId,
                    amounts: [
                      { currency: "USD", unit: "cents", value: 500 },
                      { currency: "EUR", unit: "cents", value: 430 },
                    ],
                  },
                  {
                    cycleId: created.annualCycleId,
                    amounts: [
                      { currency: "USD", unit: "cents", value: 400 },
                      { currency: "EUR", unit: "cents", value: 340 },
                    ],
                  },
                ],
              },
              {
                startingAtPackSizeCredits: 10,
                prices: [
                  {
                    cycleId: created.monthlyCycleId,
                    amounts: [
                      { currency: "USD", unit: "cents", value: 400 },
                      { currency: "EUR", unit: "cents", value: 340 },
                    ],
                  },
                  {
                    cycleId: created.annualCycleId,
                    amounts: [
                      { currency: "USD", unit: "cents", value: 350 },
                      { currency: "EUR", unit: "cents", value: 300 },
                    ],
                  },
                ],
              },
            ],
            topUpCreditPackSizes: { static: [1, 5, 10, 20], dynamic: null },
          },
        ],
        addOnTypeIds: [],
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.planId).toMatch(/^plan_[a-z0-9]{20}$/);
    created.planId = body.planId;
  });

  it("creates a tenant", async () => {
    const { status, body } = await post<Tenant>({
      path: "/v0/tenant",
      body: {
        externalIds: {
          /* The value is the suite name: the marker key is shared, so
           * suite-scoped collection filters on the value. */
          [TEST_SUITE_RESOURCE_MARKER]: SUITE,
          userId: `${SUITE}-${RUN_ID}-user`,
          stripeCustomerId: `${SUITE}-${RUN_ID}-customer`,
        },
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.tenantId).toMatch(/^tenant_[a-z0-9]{22}$/);
    created.tenantId = body.tenantId;
  });

  it("assigns the tenant to the plan", async () => {
    const { status, body } = await post<Assignment>({
      path: `/v0/tenant/${created.tenantId}/assignment`,
      body: {
        planId: created.planId,
        experimentId: null,
        cycleId: created.monthlyCycleId,
        startsAt: Date.now(),
        endsAt: null,
        addOns: [],
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.assignmentId).toMatch(/^assignment_[a-z0-9]{24}$/);
  });

  it("overrides a feature assignment", async () => {
    const { status, body } = await post<FeatureEntitlement>({
      path: `/v0/tenant/${created.tenantId}/feature-override`,
      body: {
        featureId: created.crmFeatureId,
        setTo: ["hubspot", "attio", "salesforce"],
        byTeamMemberId: created.teamMemberId,
        reason: null,
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
  });

  it("overrides a meter assignment", async () => {
    const { status, body } = await post<MeterEntitlement>({
      path: `/v0/tenant/${created.tenantId}/meter-override`,
      body: {
        meterId: created.meterId,
        defaultCredits: 15,
        limitCredits: 30,
        reset: "billing_cycle_end",
        rollovers: 1,
        topUpPricesPerCredit: [
          {
            startingAtPackSizeCredits: 0,
            prices: [
              {
                cycleId: created.monthlyCycleId,
                amounts: [
                  { currency: "USD", unit: "cents", value: 400 },
                  { currency: "EUR", unit: "cents", value: 340 },
                ],
              },
              {
                cycleId: created.annualCycleId,
                amounts: [
                  { currency: "USD", unit: "cents", value: 350 },
                  { currency: "EUR", unit: "cents", value: 300 },
                ],
              },
            ],
          },
        ],
        topUpCreditPackSizes: { static: [1, 5, 10, 20], dynamic: null },
        byTeamMemberId: created.teamMemberId,
        reason: null,
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
  });

  it("reads feature entitlements reflecting the plan and override", async () => {
    const { status, body } = await get<FeatureEntitlement[]>({
      path: `/v0/tenant/${created.tenantId}/feature-entitlements`,
    });
    expect(status, JSON.stringify(body)).toBe(200);
    const slack = body.find(
      (entitlement) => entitlement.featureId === created.slackFeatureId,
    );
    const crm = body.find(
      (entitlement) => entitlement.featureId === created.crmFeatureId,
    );
    expect(slack?.setTo).toBe(false);
    expect(
      Array.isArray(crm?.setTo) ? [...crm.setTo].sort() : crm?.setTo,
    ).toEqual(["attio", "hubspot", "salesforce"]);
  });

  it("reads meter entitlements reflecting the override", async () => {
    const { status, body } = await get<MeterEntitlement[]>({
      path: `/v0/tenant/${created.tenantId}/meter-entitlements`,
    });
    expect(status, JSON.stringify(body)).toBe(200);
    const meter = body.find(
      (entitlement) => entitlement.meterId === created.meterId,
    );
    expect(meter?.defaultCredits).toBe(15);
    expect(meter?.limitCredits).toBe(30);
  });

  it("reads the meter balance", async () => {
    const { status, body } = await get<MeterBalance>({
      path: `/v0/tenant/${created.tenantId}/meter-balance/${created.meterId}`,
    });
    expect(status, JSON.stringify(body)).toBe(200);
    /* The balance initializes from the plan's default (10) at assignment
     * time. The override's default (15) applies at the next billing-cycle
     * reset; it does not retcon the current cycle's balance. */
    expect(body.balanceCredits).toBe(10);
  });

  it("records a meter event", async () => {
    const { status, body } = await post<MeterEvent>({
      path: `/v0/tenant/${created.tenantId}/meter-event`,
      body: {
        externalId: `${TEST_SUITE_RESOURCE_MARKER}-${SUITE}-${RUN_ID}-event-1`,
        meterId: created.meterId,
        amountCredits: 1,
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.status).toBe("succeeded");
    expect(body.balanceCredits).toBe(9);
  });

  it("deduplicates a meter event replayed with the same externalId", async () => {
    const { status, body } = await post<MeterEvent>({
      path: `/v0/tenant/${created.tenantId}/meter-event`,
      body: {
        externalId: `${TEST_SUITE_RESOURCE_MARKER}-${SUITE}-${RUN_ID}-event-1`,
        meterId: created.meterId,
        amountCredits: 1,
      },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.status).toBe("succeeded");
    expect(body.balanceCredits).toBe(9);
  });
});
