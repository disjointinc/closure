import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { postgresUrl } from "../../config.ts";
import * as schema from "./schema.ts";

export const db = drizzle(postgres(postgresUrl), { schema });
