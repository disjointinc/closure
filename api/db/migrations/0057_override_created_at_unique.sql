-- created_at becomes unique per tenant and meter (and per tenant and
-- feature), so existing ties are first spread 1ms apart, in (created_at, id)
-- order. Each row moves to the later of its own created_at and the previous
-- row's new created_at plus 1. That running value equals the row's position
-- plus the running max of (created_at - position), which window functions
-- can compute in one pass.
UPDATE "feature_overrides" AS "override"
SET "created_at" = "shifted"."created_at"
FROM (
  SELECT
    "feature_override_id",
    "position" + max("created_at" - "position") OVER (
      PARTITION BY "tenant_id", "feature_id"
      ORDER BY "position"
    ) AS "created_at"
  FROM (
    SELECT
      "feature_override_id",
      "tenant_id",
      "feature_id",
      "created_at",
      row_number() OVER (
        PARTITION BY "tenant_id", "feature_id"
        ORDER BY "created_at", "feature_override_id"
      ) AS "position"
    FROM "feature_overrides"
  ) AS "ordered"
) AS "shifted"
WHERE "override"."feature_override_id" = "shifted"."feature_override_id"
  AND "override"."created_at" <> "shifted"."created_at";--> statement-breakpoint
UPDATE "meter_overrides" AS "override"
SET "created_at" = "shifted"."created_at"
FROM (
  SELECT
    "meter_override_id",
    "position" + max("created_at" - "position") OVER (
      PARTITION BY "tenant_id", "meter_id"
      ORDER BY "position"
    ) AS "created_at"
  FROM (
    SELECT
      "meter_override_id",
      "tenant_id",
      "meter_id",
      "created_at",
      row_number() OVER (
        PARTITION BY "tenant_id", "meter_id"
        ORDER BY "created_at", "meter_override_id"
      ) AS "position"
    FROM "meter_overrides"
  ) AS "ordered"
) AS "shifted"
WHERE "override"."meter_override_id" = "shifted"."meter_override_id"
  AND "override"."created_at" <> "shifted"."created_at";--> statement-breakpoint
CREATE UNIQUE INDEX "feature_overrides_one_per_created_at" ON "feature_overrides" USING btree ("tenant_id","feature_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meter_overrides_one_per_created_at" ON "meter_overrides" USING btree ("tenant_id","meter_id","created_at");
