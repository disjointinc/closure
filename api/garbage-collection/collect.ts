/**
 * collect.ts -- runs one garbage-collection pass, then exits.
 *
 * Run on the host with `npm run garbage-collect -w api` (targets localhost
 * per config.ts). The long-running server runs the same pass hourly via
 * startGarbageCollectionLoop; this is the manual path.
 */
import { redis } from "../cache/index.ts";
import { db } from "../db/index.ts";
import { collectTestSuiteResources } from "./test-suite-resources.ts";

await collectTestSuiteResources();
await redis.quit();
await db.$client.end();
console.log("Garbage collection complete");
