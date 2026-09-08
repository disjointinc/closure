/**
 * v0/experiment/routes.ts -- HTTP for /v0/experiment: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { experimentSchema } from "../../schemas/experiment.ts";
import { planIdSchema } from "../../schemas/ids.ts";
import {
  concludeExperiment,
  createExperiment,
  getExperiment,
  listExperiments,
} from "./service.ts";

/* z.object(shape) because .omit() fails on schemas carrying refinements; the
   treatment-percentage superRefine is re-applied below. */
const experimentCreateSchema = z
  .object(experimentSchema.shape)
  .omit({
    concludedAt: true,
    concludingPlanId: true,
    createdAt: true,
    experimentId: true,
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
  });

export type ExperimentCreateBody = z.infer<typeof experimentCreateSchema>;

const concludeSchema = z.object({
  concludingPlanId: planIdSchema.nullable(),
});

export type ConcludeExperimentBody = z.infer<typeof concludeSchema>;

export const experimentApp = new Hono()
  .post("/", zValidator("json", experimentCreateSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createExperiment({ experiment: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listExperiments());
  })
  .get("/:experimentId", async (c) => {
    const experiment = await getExperiment({
      experimentId: c.req.param("experimentId"),
    });
    if (!experiment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(experiment);
  })
  .post(
    "/:experimentId/conclude",
    zValidator("json", concludeSchema),
    async (c) => {
      const experiment = await concludeExperiment({
        body: c.req.valid("json"),
        experimentId: c.req.param("experimentId"),
      });
      if (!experiment) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(experiment);
    },
  );
