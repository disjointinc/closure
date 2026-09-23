/**
 * Serves api/handler.ts over node:http for the hobby deploy.
 *
 * Before accepting traffic, rebuild any meter balances whose Redis keys were
 * lost (Redis restart, flush, failover) from the pg checkpoints; then start
 * the write-behind and reconcile loops.
 */
import { serve } from "@hono/node-server";
import { config } from "../config.ts";
import {
  rebuildMissingMeterBalances,
  startMeteringFlushLoop,
} from "./cache/meter/index.ts";
import { startMeteringReconcileLoop } from "./cache/meter/reconcile.ts";
import { startRuleExecutorLoop } from "./cache/rule/execute.ts";
import { startRuleSchedulerLoop } from "./cache/rule/schedule.ts";
import { startGarbageCollectionLoop } from "./garbage-collection/test-suite-resources.ts";
import app from "./handler.ts";

await rebuildMissingMeterBalances();
startMeteringFlushLoop();
startMeteringReconcileLoop();
startRuleSchedulerLoop();
startRuleExecutorLoop();
if (config.garbageCollection.enabled) {
  startGarbageCollectionLoop();
}

serve(
  {
    fetch: app.fetch,
    hostname: config.api.host,
    port: config.api.port,
  },
  (info) => {
    console.log(`Closure API listening on http://${info.address}:${info.port}`);
  },
);
