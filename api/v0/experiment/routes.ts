/**
 * v0/experiment/routes.ts -- HTTP for /v0/experiment: request validation
 * and wiring. Business logic lives in service.ts.
 */
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { invalidResponse, notFoundResponse } from "../../lib/http.ts";
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

const createExperimentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["experiment"],
  summary: "Create an experiment",
  request: {
    body: {
      content: { "application/json": { schema: experimentCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: experimentSchema } },
      description: "Created",
    },
    400: invalidResponse,
  },
});

const listExperimentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["experiment"],
  summary: "List experiments",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(experimentSchema) } },
      description: "OK",
    },
  },
});

const getExperimentRoute = createRoute({
  method: "get",
  path: "/{experimentId}",
  tags: ["experiment"],
  summary: "Get an experiment",
  request: { params: experimentParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: experimentSchema } },
      description: "OK",
    },
    404: notFoundResponse,
  },
});

const concludeExperimentRoute = createRoute({
  method: "post",
  path: "/{experimentId}/conclude",
  tags: ["experiment"],
  summary: "Conclude an experiment",
  request: {
    params: experimentParamSchema,
    body: {
      content: { "application/json": { schema: concludeSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: experimentSchema } },
      description: "OK",
    },
    400: invalidResponse,
    404: notFoundResponse,
  },
});

export const experimentApp = new OpenAPIHono()
  .openapi(createExperimentRoute, async (c) => {
    const body = c.req.valid("json");
    const experiment = await createExperiment({ experiment: body });
    if ("error" in experiment) {
      return c.json(experiment, 400);
    }
    return c.json(experiment, 201);
  })
  .openapi(listExperimentsRoute, async (c) => {
    return c.json(await listExperiments(), 200);
  })
  .openapi(getExperimentRoute, async (c) => {
    const experiment = await getExperiment(c.req.valid("param"));
    if (!experiment) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(experiment, 200);
  })
  .openapi(concludeExperimentRoute, async (c) => {
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
    return c.json(experiment, 200);
  });
