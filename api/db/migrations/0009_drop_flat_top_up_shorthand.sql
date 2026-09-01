-- Flat per-credit top-up shorthand removed: a stored jsonb string is a
-- value id, an array is already tiered. Convert the shorthand to the
-- single-tier shape with no prices.
UPDATE "plan_meters"
SET "top_up_prices_per_credit" = jsonb_build_array(
  jsonb_build_object('startingAt', 1, 'prices', '[]'::jsonb)
)
WHERE jsonb_typeof("top_up_prices_per_credit") = 'string';
--> statement-breakpoint
UPDATE "meter_overrides"
SET "top_up_prices_per_credit" = jsonb_build_array(
  jsonb_build_object('startingAt', 1, 'prices', '[]'::jsonb)
)
WHERE jsonb_typeof("top_up_prices_per_credit") = 'string';
