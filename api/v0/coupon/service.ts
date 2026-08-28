/**
 * v0/coupon/service.ts -- coupon business logic. Coupons are consumables
 * (deletes mark deletedAt) minted either inline or from a coupon template;
 * minting copies the template's definition, so issued coupons never change
 * when the template is edited or deprecated later. Award amounts are read
 * and written as full values; the canonical award stored in the db keeps
 * the value id.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  couponCreditsGranted,
  couponFeaturesGranted,
  coupons,
} from "../../db/schema.ts";
import { type Award, type Coupon } from "../../schemas/coupon.ts";
import { type AwardApi, expandAward, resolveAward } from "../award/service.ts";
import { getCouponTemplate } from "../coupon-template/service.ts";
import type { CouponCreateBody } from "./routes.ts";

type WithAwardApi<T extends { award: Award }> = Omit<T, "award"> & {
  award: AwardApi;
};

/** The call-surface coupon: awards carry full values instead of value ids. */
export type CouponApi = Omit<
  Coupon,
  "defaultAward" | "featuresGranted" | "creditsGranted"
> & {
  defaultAward: AwardApi | null;
  featuresGranted:
    WithAwardApi<NonNullable<Coupon["featuresGranted"]>[number]>[] | null;
  creditsGranted:
    WithAwardApi<NonNullable<Coupon["creditsGranted"]>[number]>[] | null;
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
    templateId: row.templateId,
    grantableByTenants: row.grantableByTenants,
    limitPerGrantingTenant: row.limitPerGrantingTenant,
    name: row.name,
    description: row.description,
    defaultAward: row.defaultAward ? await expandAward(row.defaultAward) : null,
    featuresGranted: featureRows.length
      ? await Promise.all(
          featureRows.map(async (feature) => ({
            featureId: feature.featureId,
            setTo: feature.setTo,
            award: await expandAward(feature.award),
          })),
        )
      : null,
    creditsGranted: creditRows.length
      ? await Promise.all(
          creditRows.map(async (credit) => ({
            meterId: credit.meterId,
            amountMicrocredits: credit.amountMicrocredits,
            expiration: credit.expiration,
            rollovers: credit.rollovers,
            award: await expandAward(credit.award),
          })),
        )
      : null,
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
 * Mint a coupon. With `templateId` set, the definition is copied from the
 * template (returns null if no such template exists); otherwise the body's
 * inline definition is used, storing each award's value.
 */
export async function createCoupon({
  coupon,
}: {
  coupon: CouponCreateBody;
}): Promise<CouponApi | null> {
  // An explicit null check, not a truthiness check: the template branch's
  // templateId is a string, and "" is falsy, so truthiness wouldn't narrow
  // the union.
  if (coupon.templateId !== null && coupon.templateId !== undefined) {
    const template = await getCouponTemplate({
      couponTemplateId: coupon.templateId,
    });
    if (!template) {
      return null;
    }
    await db
      .insert(coupons)
      .values({
        couponId: coupon.couponId,
        createdAt: coupon.createdAt,
        deletedAt: coupon.deletedAt,
        templateId: template.couponTemplateId,
        grantableByTenants: template.grantableByTenants,
        limitPerGrantingTenant: template.limitPerGrantingTenant,
        name: template.name,
        description: template.description,
        // The template reads back in the call-surface shape (full values),
        // so re-resolving stores the same values and yields the canonical
        // (value-id) award for the copy.
        defaultAward: template.defaultAward
          ? await resolveAward(template.defaultAward)
          : null,
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
            couponId: coupon.couponId,
            featureId: feature.featureId,
            setTo: feature.setTo,
            award: await resolveAward(feature.award),
          })
          .onConflictDoNothing();
      }
    }
    if (template.creditsGranted) {
      for (const credit of template.creditsGranted) {
        await db
          .insert(couponCreditsGranted)
          .values({
            couponId: coupon.couponId,
            meterId: credit.meterId,
            amountMicrocredits: credit.amountMicrocredits,
            expiration: credit.expiration,
            rollovers: credit.rollovers,
            award: await resolveAward(credit.award),
          })
          .onConflictDoNothing();
      }
    }
    return getCoupon({ couponId: coupon.couponId });
  }
  await db
    .insert(coupons)
    .values({
      couponId: coupon.couponId,
      createdAt: coupon.createdAt,
      deletedAt: coupon.deletedAt,
      templateId: null,
      grantableByTenants: coupon.grantableByTenants,
      limitPerGrantingTenant: coupon.limitPerGrantingTenant,
      name: coupon.name,
      description: coupon.description,
      defaultAward: coupon.defaultAward
        ? await resolveAward(coupon.defaultAward)
        : null,
      reciprocalBenefitCouponId: coupon.reciprocalBenefitCouponId,
    })
    .onConflictDoNothing();
  if (coupon.featuresGranted) {
    for (const feature of coupon.featuresGranted) {
      await db
        .insert(couponFeaturesGranted)
        .values({
          couponId: coupon.couponId,
          featureId: feature.featureId,
          setTo: feature.setTo,
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
          couponId: coupon.couponId,
          meterId: credit.meterId,
          amountMicrocredits: credit.amountMicrocredits,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: await resolveAward(credit.award),
        })
        .onConflictDoNothing();
    }
  }
  return getCoupon({ couponId: coupon.couponId });
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
