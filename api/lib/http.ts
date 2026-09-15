/**
 * http.ts -- HTTP-layer shared bits: the error envelope every route returns
 * for business-rule failures (400/404/409/503), and the reusable OpenAPI
 * response blocks for the codes routes actually return, declared once so
 * the OpenAPI spec and the wire format agree.
 */
import { z } from "zod";

export const errorResponseSchema = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

function errorResponse(description: string) {
  return {
    content: { "application/json": { schema: errorResponseSchema } },
    description,
  };
}

export const invalidResponse = errorResponse("Invalid input");
export const notFoundResponse = errorResponse("Not found");
export const conflictResponse = errorResponse("Conflict");
export const serviceUnavailableResponse = errorResponse("Service unavailable");
