/**
 * bin/generate-env.ts -- give every password and key Closure needs a value in
 * bin/.env, which Docker Compose and config.ts both read.
 *
 * Values already in bin/.env (or set in the environment) are kept; the rest
 * get random ones. Safe to rerun: it never changes a value that's already
 * there. Plain Node, so it works on Windows, macOS, and Linux alike.
 *
 * Run from the repo root: node bin/generate-env.ts
 */
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* 16 random bytes (128 bits), as 32 hex characters: far beyond brute force,
 * and only letters and digits, so they're safe inside the connection URLs
 * some services put passwords in. */
const PASSWORD_BYTES = 16;
/* 32 random bytes: the key size AES-256 needs, for both Closure's and
 * Nango's encryption keys. */
const ENCRYPTION_KEY_BYTES = 32;

const ENV_PATH = fileURLToPath(new URL("./.env", import.meta.url));

const randomPassword = () => randomBytes(PASSWORD_BYTES).toString("hex");
const randomKey = () => randomBytes(ENCRYPTION_KEY_BYTES).toString("base64");

const settings: { name: string; value: () => string }[] = [
  { name: "CLOSURE_API_KEY", value: randomPassword },
  { name: "CLOSURE_POSTGRES_PASSWORD", value: randomPassword },
  { name: "CLOSURE_REDIS_PASSWORD", value: randomPassword },
  { name: "CLOSURE_SECRETS_KEY", value: randomKey },
  { name: "CLOSURE_NANGO_ENCRYPTION_KEY", value: randomKey },
  /* Nango rejects API keys that aren't shaped like a UUID (keyRegex in
   * Nango's packages/server/lib/middleware/access.middleware.ts). */
  { name: "CLOSURE_NANGO_SECRET_KEY", value: randomUUID },
  { name: "CLOSURE_NANGO_DASHBOARD_PASSWORD", value: randomPassword },
  /* The strength comes from randomPassword's 128 random bits. The fixed
   * "Ab1" adds none, and only satisfies Hatchet's rule that a password
   * contain an uppercase letter, a lowercase letter, and a number (hex has
   * no uppercase). That rule exists to stop people choosing guessable
   * passwords, which a random one isn't. */
  {
    name: "CLOSURE_HATCHET_DASHBOARD_PASSWORD",
    value: () => `Ab1${randomPassword()}`,
  },
];

const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
const alreadySet = new Set(
  existing
    .split(/\r?\n/)
    .map((line) => line.split("=")[0])
    .filter((name) => name !== ""),
);

const added = settings
  .filter(({ name }) => !alreadySet.has(name) && !process.env[name])
  .map(({ name, value }) => `${name}=${value()}\n`);

// A hand-edited file may not end with a newline; don't join onto its last line.
const separator = existing !== "" && !existing.endsWith("\n") ? "\n" : "";
/* Keeps the file readable only by its owner. Windows ignores the mode, and
 * its files are private to the user's profile already. */
appendFileSync(ENV_PATH, separator + added.join(""), { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);

console.log(`==> Passwords and keys: ${ENV_PATH}`);
