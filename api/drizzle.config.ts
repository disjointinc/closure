import { defineConfig } from "drizzle-kit";
import { postgresUrl } from "../config.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: postgresUrl },
});
