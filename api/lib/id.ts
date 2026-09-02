/**
 * lib/id.ts -- server-side prefixed id generation for derived entities
 * (rule runs, integration-created rows). Callers pass the id prefix; the
 * suffix length comes from schemas/ids.ts so the format check always passes.
 */
import { randomBytes } from "node:crypto";
import { idSuffixLengths, type IdPrefix } from "../schemas/ids.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a prefixed id, e.g. "rule_run_ab12...". */
export function generateId({ prefix }: { prefix: IdPrefix }): string {
  const length = idSuffixLengths[prefix];
  const bytes = randomBytes(length);
  let suffix = "";
  for (let i = 0; i < length; i++) {
    suffix += ALPHABET[bytes[i] % 36];
  }
  return `${prefix}_${suffix}`;
}
