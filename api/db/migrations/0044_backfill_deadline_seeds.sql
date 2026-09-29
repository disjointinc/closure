-- Backfill for the deadline/receipt architecture:
-- 1. Seed tenant_last_activity for never-active tenants: one row per open
--    assignment x plan meter, timestamped at assignment start (the inactivity
--    clock starts when the subscription starts). ON CONFLICT keeps real
--    activity, which is always >= the seed.
-- 2. Generate billing_periods receipts for open assignments on recurring
--    cycles: every period from assignment start through the current one
--    (marked is_current; exactly one per tenant+line).
INSERT INTO "tenant_last_activity" ("tenant_id", "meter_id", "last_event_at_micros")
SELECT a."tenant_id", pm."meter_id", a."starts_at" * 1000
FROM "assignments" a
JOIN "plan_meters" pm ON pm."plan_id" = a."plan_id"
WHERE a."ends_at" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

WITH open_assignments AS (
  SELECT
    a."tenant_id",
    a."product_line_id",
    a."assignment_id",
    a."starts_at",
    CASE
      WHEN (cy."cycle_length"->>'days') IS NOT NULL
        THEN (cy."cycle_length"->>'days')::bigint * 86400000
      ELSE (cy."cycle_length"->>'months')::bigint * 2592000000
    END AS window_ms
  FROM "assignments" a
  JOIN "cycles" cy ON cy."cycle_id" = a."cycle_id"
  WHERE a."ends_at" IS NULL
    AND cy."cycle_length" <> '"one_time"'
),
now_ms AS (
  SELECT (extract(epoch from now()) * 1000)::bigint AS v
),
series AS (
  SELECT oa.*, generate_series(
    0,
    GREATEST(floor(((SELECT v FROM now_ms) - oa."starts_at") / oa.window_ms)::bigint, 0)
  ) AS n
  FROM open_assignments oa
  WHERE oa.window_ms > 0
)
INSERT INTO "billing_periods" (
  "tenant_id", "product_line_id", "assignment_id",
  "period_start", "period_end", "window_ms", "is_current"
)
SELECT
  "tenant_id",
  "product_line_id",
  "assignment_id",
  "starts_at" + window_ms * n,
  "starts_at" + window_ms * (n + 1),
  window_ms,
  ("starts_at" + window_ms * (n + 1)) > (SELECT v FROM now_ms)
FROM series
ON CONFLICT DO NOTHING;--> statement-breakpoint
