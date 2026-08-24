/**
 * Serves api/handler.ts over node:http for the hobby deploy.
 */
import { serve } from "@hono/node-server";
import { config } from "../config.ts";
import { startMeteringFlushLoop } from "./cache/metering.ts";
import app from "./handler.ts";

startMeteringFlushLoop();

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
