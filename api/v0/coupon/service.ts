/**
 * v0/coupon/service.ts -- coupon business logic. Coupons are consumables
 * (deletes mark deleted_at) minted either inline or from a coupon template;
 * minting copies the template's definition, so issued coupons never change
 * when the template is edited or deprecated later.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  couponCreditsGranted,
  couponFeaturesGranted,
  coupons,
} from "../../db/schema.ts";
import type { Coupon } from "../../schemas/coupon.ts";
import { resolveAward } from "../award/service.ts";
import { getCouponTemplate } from "../coupon-template/service.ts";
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
    deleted_at: row.deletedAt,
    template: row.template,
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

/**
 * Mint a coupon. With `template` set, the definition is copied from the
 * template (returns null if no such template exists); otherwise the body's
 * inline definition is used, resolving inline award value refs.
 */
export async function createCoupon({
  coupon,
}: {
  coupon: CouponCreateBody;
}): Promise<Coupon | null> {
  // An explicit null check, not a truthiness check: the template branch's
  // template is a string, and "" is falsy, so truthiness wouldn't narrow
  // the union.
  if (coupon.template !== null && coupon.template !== undefined) {
    const template = await getCouponTemplate({ uniqueId: coupon.template });
    if (!template) {
      return null;
    }
    await db
      .insert(coupons)
      .values({
        uniqueId: coupon.unique_id,
        createdAt: coupon.created_at,
        deletedAt: coupon.deleted_at,
        template: template.unique_id,
        grantableByTenants: template.grantable_by_tenants,
        limitPerGrantingTenant: template.limit_per_granting_tenant,
        name: template.name,
        description: template.description,
        defaultAward: template.default_award,
        // A coupon's reciprocal benefit references an individual coupon, not
        // a template, so it can't be copied -- the caller sets it per coupon.
        reciprocalBenefitCoupon: coupon.reciprocal_benefit_coupon,
      })
      .onConflictDoNothing();
    // The template's awards are already resolved (value ids), so the grants
    // copy verbatim.
    if (template.features_granted) {
      await db
        .insert(couponFeaturesGranted)
        .values(
          template.features_granted.map((feature) => ({
            coupon: coupon.unique_id,
            feature: feature.feature,
            value: feature.value,
            award: feature.award,
          })),
        )
        .onConflictDoNothing();
    }
    if (template.credits_granted) {
      await db
        .insert(couponCreditsGranted)
        .values(
          template.credits_granted.map((credit) => ({
            coupon: coupon.unique_id,
            meter: credit.meter,
            amountMicrocredits: credit.amount,
            expiration: credit.expiration,
            rollovers: credit.rollovers,
            award: credit.award,
          })),
        )
        .onConflictDoNothing();
    }
    return getCoupon({ uniqueId: coupon.unique_id });
  }
  await db
    .insert(coupons)
    .values({
      uniqueId: coupon.unique_id,
      createdAt: coupon.created_at,
      deletedAt: coupon.deleted_at,
      template: null,
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

/** Mark the coupon deleted, or return null if no such coupon exists. */
export async function deleteCoupon({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<Coupon | null> {
  const updated = await db
    .update(coupons)
    .set({ deletedAt: Date.now() })
    .where(eq(coupons.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getCoupon({ uniqueId });
}
