/**
 * v0/coupon/service.ts -- coupon business logic. Coupons are consumables
 * (deletes mark deletedAt) minted either inline or from a coupon template;
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
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    template: row.template,
    grantableByTenants: row.grantableByTenants,
    limitPerGrantingTenant: row.limitPerGrantingTenant,
    name: row.name,
    description: row.description,
    defaultAward: row.defaultAward,
    featuresGranted: featureRows.length
      ? featureRows.map((feature) => ({
          feature: feature.feature,
          value: feature.value,
          award: feature.award,
        }))
      : null,
    creditsGranted: creditRows.length
      ? creditRows.map((credit) => ({
          meter: credit.meter,
          amount: credit.amountMicrocredits,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: credit.award,
        }))
      : null,
    reciprocalBenefitCoupon: row.reciprocalBenefitCoupon,
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
        uniqueId: coupon.uniqueId,
        createdAt: coupon.createdAt,
        deletedAt: coupon.deletedAt,
        template: template.uniqueId,
        grantableByTenants: template.grantableByTenants,
        limitPerGrantingTenant: template.limitPerGrantingTenant,
        name: template.name,
        description: template.description,
        defaultAward: template.defaultAward,
        // A coupon's reciprocal benefit references an individual coupon, not
        // a template, so it can't be copied -- the caller sets it per coupon.
        reciprocalBenefitCoupon: coupon.reciprocalBenefitCoupon,
      })
      .onConflictDoNothing();
    // The template's awards are already resolved (value ids), so the grants
    // copy verbatim.
    if (template.featuresGranted) {
      await db
        .insert(couponFeaturesGranted)
        .values(
          template.featuresGranted.map((feature) => ({
            coupon: coupon.uniqueId,
            feature: feature.feature,
            value: feature.value,
            award: feature.award,
          })),
        )
        .onConflictDoNothing();
    }
    if (template.creditsGranted) {
      await db
        .insert(couponCreditsGranted)
        .values(
          template.creditsGranted.map((credit) => ({
            coupon: coupon.uniqueId,
            meter: credit.meter,
            amountMicrocredits: credit.amount,
            expiration: credit.expiration,
            rollovers: credit.rollovers,
            award: credit.award,
          })),
        )
        .onConflictDoNothing();
    }
    return getCoupon({ uniqueId: coupon.uniqueId });
  }
  await db
    .insert(coupons)
    .values({
      uniqueId: coupon.uniqueId,
      createdAt: coupon.createdAt,
      deletedAt: coupon.deletedAt,
      template: null,
      grantableByTenants: coupon.grantableByTenants,
      limitPerGrantingTenant: coupon.limitPerGrantingTenant,
      name: coupon.name,
      description: coupon.description,
      defaultAward: coupon.defaultAward
        ? await resolveAward(coupon.defaultAward)
        : null,
      reciprocalBenefitCoupon: coupon.reciprocalBenefitCoupon,
    })
    .onConflictDoNothing();
  if (coupon.featuresGranted) {
    for (const feature of coupon.featuresGranted) {
      await db
        .insert(couponFeaturesGranted)
        .values({
          coupon: coupon.uniqueId,
          feature: feature.feature,
          value: feature.value,
          award: await resolveAward(feature.award),
        })
        .onConflictDoNothing();
    }
  }
  if (coupon.creditsGranted) {
    for (const credit of coupon.creditsGranted) {
      await db
        .insert(couponCreditsGranted)
        .values({
          coupon: coupon.uniqueId,
          meter: credit.meter,
          amountMicrocredits: credit.amount,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: await resolveAward(credit.award),
        })
        .onConflictDoNothing();
    }
  }
  return getCoupon({ uniqueId: coupon.uniqueId });
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
