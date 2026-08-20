/**
 * migrate.ts -- applies Drizzle migrations to the database, then exits.
 *
 * Run on the host with `npm run db:migrate -w api` (targets localhost per
 * config.ts). Compose runs the same file via the one-shot closure-migrate
 * service on `docker compose up`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { postgresUrl } from "../../config.ts";

const sql = postgres(postgresUrl, { max: 1, onnotice: () => {} });
await migrate(drizzle(sql), {
  migrationsFolder: `${import.meta.dirname}/migrations`,
});
await sql.end();
console.log("Migrations applied");
