/**
 * v0/experiment/routes.ts -- HTTP for /v0/experiment: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { epochMs } from "../../schemas/common.ts";
import { experimentSchema } from "../../schemas/experiment.ts";
import { planIdSchema } from "../../schemas/ids.ts";
import {
  concludeExperiment,
  createExperiment,
  getExperiment,
  listExperiments,
} from "./service.ts";

const concludeSchema = z.object({
  concluded_at: epochMs,
  plan_assignment_at_conclusion: planIdSchema.nullable(),
});

export type ConcludeExperimentBody = z.infer<typeof concludeSchema>;

export const experimentApp = new Hono()
  .post("/", zValidator("json", experimentSchema), async (c) => {
    const body = c.req.valid("json");
    return c.json(await createExperiment({ experiment: body }), 201);
  })
  .get("/", async (c) => {
    return c.json(await listExperiments());
  })
  .get("/:id", async (c) => {
    const experiment = await getExperiment({ uniqueId: c.req.param("id") });
    if (!experiment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(experiment);
  })
  .post("/:id/conclude", zValidator("json", concludeSchema), async (c) => {
    const experiment = await concludeExperiment({
      body: c.req.valid("json"),
      uniqueId: c.req.param("id"),
    });
    if (!experiment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(experiment);
  });
