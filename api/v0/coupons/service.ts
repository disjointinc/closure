/**
 * v0/coupons/service.ts -- coupon business logic. features_granted /
 * credits_granted are passed inline; award values may be existing value ids
 * or inline definitions. Immutable, so deletes deprecate.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  couponCreditsGranted,
  couponFeaturesGranted,
  coupons,
} from "../../db/schema.ts";
import type { Coupon } from "../../schemas/coupon.ts";
import { resolveAward } from "../helpers.ts";
import type { CouponCreateBody } from "./routes.ts";

export async function getCoupon({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Coupon | null> {
  const [row] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const featureRows = await db
    .select()
    .from(couponFeaturesGranted)
    .where(eq(couponFeaturesGranted.coupon, uniqueId));
  const creditRows = await db
    .select()
    .from(couponCreditsGranted)
    .where(eq(couponCreditsGranted.coupon, uniqueId));
  return {
    unique_id: row.uniqueId,
    created_at: row.createdAt,
    deprecated_at: row.deprecatedAt,
    grantable_by_tenants: row.grantableByTenants,
    limit_per_granting_tenant: row.limitPerGrantingTenant,
    name: row.name,
    description: row.description,
    default_award: row.defaultAward,
    features_granted: featureRows.length
      ? featureRows.map((feature) => ({
          feature: feature.feature,
          value: feature.value,
          award: feature.award,
        }))
      : null,
    credits_granted: creditRows.length
      ? creditRows.map((credit) => ({
          meter: credit.meter,
          amount: credit.amountMicrocredits,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: credit.award,
        }))
      : null,
    reciprocal_benefit_coupon: row.reciprocalBenefitCoupon,
  };
}

export async function listCoupons(): Promise<Coupon[]> {
  const rows = await db.select().from(coupons);
  const found = await Promise.all(
    rows.map((row) => getCoupon({ uniqueId: row.uniqueId })),
  );
  return found.filter((coupon) => coupon !== null);
}

export async function createCoupon({
  coupon,
}: {
  coupon: CouponCreateBody;
}): Promise<Coupon | null> {
  await db
    .insert(coupons)
    .values({
      uniqueId: coupon.unique_id,
      createdAt: coupon.created_at,
      deprecatedAt: coupon.deprecated_at,
      grantableByTenants: coupon.grantable_by_tenants,
      limitPerGrantingTenant: coupon.limit_per_granting_tenant,
      name: coupon.name,
      description: coupon.description,
      defaultAward: coupon.default_award
        ? await resolveAward(coupon.default_award)
        : null,
      reciprocalBenefitCoupon: coupon.reciprocal_benefit_coupon,
    })
    .onConflictDoNothing();
  if (coupon.features_granted) {
    for (const feature of coupon.features_granted) {
      await db
        .insert(couponFeaturesGranted)
        .values({
          coupon: coupon.unique_id,
          feature: feature.feature,
          value: feature.value,
          award: await resolveAward(feature.award),
        })
        .onConflictDoNothing();
    }
  }
  if (coupon.credits_granted) {
    for (const credit of coupon.credits_granted) {
      await db
        .insert(couponCreditsGranted)
        .values({
          coupon: coupon.unique_id,
          meter: credit.meter,
          amountMicrocredits: credit.amount,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: await resolveAward(credit.award),
        })
        .onConflictDoNothing();
    }
  }
  return getCoupon({ uniqueId: coupon.unique_id });
}

/** Deprecate the coupon, or return null if no such coupon exists. */
export async function deprecateCoupon({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Coupon | null> {
  const updated = await db
    .update(coupons)
    .set({ deprecatedAt: Date.now() })
    .where(eq(coupons.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getCoupon({ uniqueId });
}
