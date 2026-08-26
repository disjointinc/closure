import { idSuffixLengths, type IdPrefix } from "../../../api/schemas/ids.ts";

/**
 * Client-side id generation mirroring the API's format (see
 * api/schemas/ids.ts for prefix + length rules).
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateId(prefix: IdPrefix): string {
  const length = idSuffixLengths[prefix];
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (let i = 0; i < length; i++) {
    suffix += ALPHABET[bytes[i] % 36];
  }
  return `${prefix}_${suffix}`;
}
