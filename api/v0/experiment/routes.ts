/**
 * v0/experiment/routes.ts -- HTTP for /v0/experiment: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../schemas/common.ts";
import { experimentSchema } from "../../schemas/experiment.ts";
import { cycleIdSchema, experimentIdSchema } from "../../schemas/ids.ts";
import { treatmentSchema } from "../../schemas/treatment.ts";
import {
  concludeExperiment,
  createExperiment,
  getExperiment,
  listExperiments,
} from "./service.ts";

/* The cycle/timing terms every auto-created assignment uses: creating an
 * experiment with assigned tenants enrolls them on the treatment plans
 * server-side, so the terms ride along on the create body. */
const assignmentTermsSchema = z.object({
  cycleId: cycleIdSchema,
  startsAt: epochMs,
  endsAt: epochMs.nullable(),
});

const experimentCreateSchema = experimentSchema
  .omit({
    concludedAt: true,
    concludingPlans: true,
    createdAt: true,
    experimentId: true,
    treatments: true,
  })
  .extend({
    assignmentTerms: assignmentTermsSchema.nullable(),
    treatments: z.array(treatmentSchema.omit({ treatmentId: true })).min(2),
  })
  .superRefine((experiment, ctx) => {
    const total = experiment.treatments.reduce(
      (sum, treatment) => sum + treatment.tenantPercentage,
      0,
    );
    if (Math.abs(total - 100) > 1e-9) {
      ctx.addIssue({
        code: "custom",
        path: ["treatments"],
        message: "treatment percentages must sum to 100",
      });
    }
    const assignsTenants = experiment.treatments.some(
      (treatment) => treatment.assignedTenantIds?.length,
    );
    if (assignsTenants && experiment.assignmentTerms === null) {
      ctx.addIssue({
        code: "custom",
        path: ["assignmentTerms"],
        message: "assignment terms are required when treatments assign tenants",
      });
    }
  });

export type ExperimentCreateBody = z.infer<typeof experimentCreateSchema>;

const concludeSchema = z.object({
  concludingPlans: experimentSchema.shape.concludingPlans.unwrap(),
});

export type ConcludeExperimentBody = z.infer<typeof concludeSchema>;

const experimentParamSchema = z.object({ experimentId: experimentIdSchema });

export const experimentApp = new Hono()
  .post("/", zValidator("json", experimentCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const experiment = await createExperiment({ experiment: body });
    if ("error" in experiment) {
      return c.json(experiment, 400);
    }
    return c.json(experiment, 201);
  })
  .get("/", async (c) => {
    return c.json(await listExperiments());
  })
  .get(
    "/:experimentId",
    zValidator("param", experimentParamSchema),
    async (c) => {
      const experiment = await getExperiment(c.req.valid("param"));
      if (!experiment) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(experiment);
    },
  )
  .post(
    "/:experimentId/conclude",
    zValidator("param", experimentParamSchema),
    zValidator("json", concludeSchema),
    async (c) => {
      const experiment = await concludeExperiment({
        body: c.req.valid("json"),
        experimentId: c.req.valid("param").experimentId,
      });
      if (!experiment) {
        return c.json({ error: "not found" }, 404);
      }
      if ("error" in experiment) {
        return c.json(experiment, 400);
      }
      return c.json(experiment);
    },
  );
