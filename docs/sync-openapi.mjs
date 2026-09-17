import { readFile, writeFile } from "node:fs/promises";

const SPEC_URL =
  process.env.CLOSURE_API_URL ?? "http://closure-api:3216/openapi.json";
const OUTPUT_FILE = new URL("./openapi.json", import.meta.url);
const POLL_INTERVAL_MS = 2_000;
const BOOT_ATTEMPT_LIMIT = 30;

const sleep = ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms));

const writeSpecIfChanged = async () => {
  const response = await fetch(SPEC_URL);
  if (!response.ok) throw new Error(`GET ${SPEC_URL} -> ${response.status}`);
  const spec = await response.text();
  const current = await readFile(OUTPUT_FILE, "utf8").catch(() => null);
  if (spec === current) return;
  await writeFile(OUTPUT_FILE, spec);
  console.log(`sync-openapi: wrote ${spec.length} bytes`);
};

// mint refuses to boot without the spec file, so the initial write must
// outlast a not-yet-serving API before giving up.
const writeSpecWithRetries = async () => {
  for (let attempt = 1; attempt <= BOOT_ATTEMPT_LIMIT; attempt++) {
    try {
      await writeSpecIfChanged();
      return;
    } catch (error) {
      console.error(
        `sync-openapi: attempt ${attempt}/${BOOT_ATTEMPT_LIMIT} failed`,
        error,
      );
      await sleep({ ms: POLL_INTERVAL_MS });
    }
  }
  throw new Error(`sync-openapi: API never served the spec`);
};

await writeSpecWithRetries();
if (process.argv.includes("--once")) process.exit(0);

setInterval(() => {
  writeSpecIfChanged().catch((error) =>
    console.error("sync-openapi: poll failed", error),
  );
}, POLL_INTERVAL_MS);
