/**
 * api.ts -- the typed Closure API client. AppType carries the full route
 * schema, so every call here is checked against the API's routes and
 * request/response shapes.
 */
import { hc, type ClientResponse } from "hono/client";
import type { StatusCode } from "hono/utils/http-status";
import type { AppType } from "../../../api/handler.ts";

const API_URL = "http://localhost:3226";

export const api = hc<AppType>(API_URL);

/**
 * The success (2xx) payload of a hono/client response union: the client
 * types one ClientResponse per status variant, so extract the 2xx member.
 */
type SuccessData<R> =
  R extends ClientResponse<infer T, infer S, string>
    ? S extends 200 | 201
      ? T
      : never
    : never;

/** Await a hono/client call, throwing a useful error on any non-2xx. */
export async function unwrap<
  R extends ClientResponse<unknown, StatusCode, string>,
>(promise: Promise<R>): Promise<SuccessData<R>> {
  const response = await promise;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json() as Promise<SuccessData<R>>;
}

/** True when a text input is shaped like an id (e.g. plan_abc123). */
export function looksLikeId(value: string): boolean {
  return /^[a-z_]+_[a-z0-9]{2,}$/.test(value.trim());
}
