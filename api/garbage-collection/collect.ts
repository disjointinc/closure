/**
 * collect.ts -- runs one round of every registered garbage collector, then
 * exits. The long-running server runs the same round on an interval
 * (loop.ts); this is the manual path.
 */
import { redis } from "../cache/index.ts";
import { db } from "../db/index.ts";
import { collectGarbage } from "./loop.ts";

await collectGarbage();
await redis.quit();
await db.$client.end();
console.log("Garbage collection complete");
