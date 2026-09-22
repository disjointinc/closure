/**
 * v0/coupon/service.ts -- coupon business logic. Coupons are consumables
 * (deletes mark deletedAt) minted either inline or from a coupon template;
 * minting copies the template's definition, so issued coupons never change
 * when the template is edited or deprecated later. Award amounts are stored
 * inline.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  couponCreditsGranted,
  couponFeaturesGranted,
  coupons,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import { type Award, type Coupon } from "../../schemas/coupon.ts";
import { getCouponTemplate } from "../coupon-template/service.ts";

/**
 * The create-input coupon: microcredits, awards as full values. Minted
 * either inline (couponTemplateId null) or copied from a template, whose
 * definitional fields are then not accepted.
 */
export type CouponCreateBody =
  | (Omit<
      CouponApi,
      "couponId" | "createdAt" | "deletedAt" | "couponTemplateId"
    > & {
      couponTemplateId: null;
    })
  | {
      couponTemplateId: string;
      reciprocalBenefitCouponId: string | null;
    };

/**
 * The call-surface coupon: awards carry full values instead of value ids.
 */
export type CouponApi = Omit<
  Coupon,
  "defaultAward" | "featuresGranted" | "creditsGranted"
> & {
  defaultAward: Award | null;
  featuresGranted: Coupon["featuresGranted"];
  creditsGranted: Coupon["creditsGranted"];
};

export async function getCoupon({
  couponId,
}: {
  couponId: string;
}): Promise<CouponApi | null> {
  const [row] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.couponId, couponId));
  if (!row) {
    return null;
  }
  const featureRows = await db
    .select()
    .from(couponFeaturesGranted)
    .where(eq(couponFeaturesGranted.couponId, couponId));
  const creditRows = await db
    .select()
    .from(couponCreditsGranted)
    .where(eq(couponCreditsGranted.couponId, couponId));
  return {
    couponId: row.couponId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    couponTemplateId: row.couponTemplateId,
    grantableByTenants: row.grantableByTenants,
    limitPerGrantingTenant: row.limitPerGrantingTenant,
    name: row.name,
    description: row.description,
    defaultAward: row.defaultAward,
    featuresGranted: featureRows.map((feature) => ({
      featureId: feature.featureId,
      setTo: feature.setTo,
      award: feature.award,
    })),
    creditsGranted: creditRows.map((credit) => ({
      meterId: credit.meterId,
      amountMicrocredits: credit.amountMicrocredits,
      expiration: credit.expiration,
      rollovers: credit.rollovers,
      award: credit.award,
    })),
    reciprocalBenefitCouponId: row.reciprocalBenefitCouponId,
  };
}

export async function listCoupons(): Promise<CouponApi[]> {
  const rows = await db.select().from(coupons);
  const found = await Promise.all(
    rows.map((row) => getCoupon({ couponId: row.couponId })),
  );
  return found.filter((coupon) => coupon !== null);
}

/**
 * Mint a coupon. With `couponTemplateId` set, the definition is copied from
 * the template (returns null if no such template exists); otherwise the
 * body's inline definition is used, storing each award's value.
 */
export async function createCoupon({
  coupon,
}: {
  coupon: CouponCreateBody;
}): Promise<CouponApi | null> {
  const couponId = generateId({ prefix: "coupon" });
  const createdAt = Date.now();
  // An explicit null check, not a truthiness check: the template branch's
  // couponTemplateId is a string, and "" is falsy, so truthiness wouldn't
  // narrow the union.
  if (coupon.couponTemplateId !== null) {
    const template = await getCouponTemplate({
      couponTemplateId: coupon.couponTemplateId,
    });
    if (!template) {
      return null;
    }
    await db
      .insert(coupons)
      .values({
        couponId,
        createdAt,
        deletedAt: null,
        couponTemplateId: template.couponTemplateId,
        grantableByTenants: template.grantableByTenants,
        limitPerGrantingTenant: template.limitPerGrantingTenant,
        name: template.name,
        description: template.description,
        defaultAward: template.defaultAward,
        // A coupon's reciprocal benefit references an individual coupon, not
        // a template, so it can't be copied -- the caller sets it per coupon.
        reciprocalBenefitCouponId: coupon.reciprocalBenefitCouponId,
      })
      .onConflictDoNothing();
    if (template.featuresGranted) {
      for (const feature of template.featuresGranted) {
        await db
          .insert(couponFeaturesGranted)
          .values({
            couponId,
            featureId: feature.featureId,
            setTo: feature.setTo,
            award: feature.award,
          })
          .onConflictDoNothing();
      }
    }
    if (template.creditsGranted) {
      for (const credit of template.creditsGranted) {
        await db
          .insert(couponCreditsGranted)
          .values({
            couponId,
            meterId: credit.meterId,
            amountMicrocredits: credit.amountMicrocredits,
            expiration: credit.expiration,
            rollovers: credit.rollovers,
            award: credit.award,
          })
          .onConflictDoNothing();
      }
    }
    return getCoupon({ couponId });
  }
  await db
    .insert(coupons)
    .values({
      couponId,
      createdAt,
      deletedAt: null,
      couponTemplateId: null,
      grantableByTenants: coupon.grantableByTenants,
      limitPerGrantingTenant: coupon.limitPerGrantingTenant,
      name: coupon.name,
      description: coupon.description,
      defaultAward: coupon.defaultAward,
      reciprocalBenefitCouponId: coupon.reciprocalBenefitCouponId,
    })
    .onConflictDoNothing();
  if (coupon.featuresGranted) {
    for (const feature of coupon.featuresGranted) {
      await db
        .insert(couponFeaturesGranted)
        .values({
          couponId,
          featureId: feature.featureId,
          setTo: feature.setTo,
          award: feature.award,
        })
        .onConflictDoNothing();
    }
  }
  if (coupon.creditsGranted) {
    for (const credit of coupon.creditsGranted) {
      await db
        .insert(couponCreditsGranted)
        .values({
          couponId,
          meterId: credit.meterId,
          amountMicrocredits: credit.amountMicrocredits,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: credit.award,
        })
        .onConflictDoNothing();
    }
  }
  return getCoupon({ couponId });
}

/** Mark the coupon deleted, or return null if no such coupon exists. */
export async function deleteCoupon({
  couponId,
}: {
  couponId: string;
}): Promise<CouponApi | null> {
  const updated = await db
    .update(coupons)
    .set({ deletedAt: Date.now() })
    .where(eq(coupons.couponId, couponId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getCoupon({ couponId });
}
