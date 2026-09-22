-- Pack-size semantics: rename dynamic pack-size keys (amounts port
-- unchanged), and null out top-up pricing tiers -- their startingAt values
-- were denominated "past the default allocation" and have no pack-size
-- equivalent, so tier pricing must be re-entered.
UPDATE "plan_meters"
SET "top_up_credit_pack_sizes" = jsonb_build_object(
  'static', "top_up_credit_pack_sizes"->'static',
  'dynamic', jsonb_build_object(
    'packSizeIntervalMicrocredits', "top_up_credit_pack_sizes"#>'{dynamic,interval}',
    'minimumPackSizeMicrocredits', "top_up_credit_pack_sizes"#>'{dynamic,minimum}',
    'maximumPackSizeMicrocredits', "top_up_credit_pack_sizes"#>'{dynamic,maximum}'
  )
)
WHERE jsonb_typeof("top_up_credit_pack_sizes"->'dynamic') = 'object';--> statement-breakpoint
UPDATE "plan_meters" SET "top_up_prices_per_credit" = NULL WHERE "top_up_prices_per_credit" IS NOT NULL;--> statement-breakpoint
UPDATE "meter_overrides"
SET "top_up_credit_pack_sizes" = jsonb_build_object(
  'static', "top_up_credit_pack_sizes"->'static',
  'dynamic', jsonb_build_object(
    'packSizeIntervalMicrocredits', "top_up_credit_pack_sizes"#>'{dynamic,interval}',
    'minimumPackSizeMicrocredits', "top_up_credit_pack_sizes"#>'{dynamic,minimum}',
    'maximumPackSizeMicrocredits', "top_up_credit_pack_sizes"#>'{dynamic,maximum}'
  )
)
WHERE jsonb_typeof("top_up_credit_pack_sizes"->'dynamic') = 'object';--> statement-breakpoint
UPDATE "meter_overrides" SET "top_up_prices_per_credit" = NULL WHERE "top_up_prices_per_credit" IS NOT NULL;
