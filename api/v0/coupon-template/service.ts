/**
 * v0/coupon-template/service.ts -- coupon template business logic.
 * Templates are reusable coupon definitions (e.g. "the referral coupon")
 * that coupons mint from; they're deprecated, never deleted. Award amounts
 * are read and written as full values; the canonical award stored in the db
 * keeps the value id.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  couponTemplateCreditsGranted,
  couponTemplateFeaturesGranted,
  couponTemplates,
} from "../../db/schema.ts";
import { generateId } from "../../lib/id.ts";
import type { Award } from "../../schemas/coupon.ts";
import type { CouponTemplate } from "../../schemas/coupon-template.ts";
import { type AwardApi, expandAward, resolveAward } from "../award/service.ts";

/** The create-input template: microcredits, awards as full values. */
export type CouponTemplateCreateBody = Omit<
  CouponTemplateApi,
  "couponTemplateId" | "createdAt" | "deprecatedAt"
>;

type WithAwardApi<T extends { award: Award }> = Omit<T, "award"> & {
  award: AwardApi;
};

/** The call-surface template: awards carry full values, not value ids. */
export type CouponTemplateApi = Omit<
  CouponTemplate,
  "defaultAward" | "featuresGranted" | "creditsGranted"
> & {
  defaultAward: AwardApi | null;
  featuresGranted:
    | WithAwardApi<NonNullable<CouponTemplate["featuresGranted"]>[number]>[]
    | null;
  creditsGranted:
    | WithAwardApi<NonNullable<CouponTemplate["creditsGranted"]>[number]>[]
    | null;
};

export async function getCouponTemplate({
  couponTemplateId,
}: {
  couponTemplateId: string;
}): Promise<CouponTemplateApi | null> {
  const [row] = await db
    .select()
    .from(couponTemplates)
    .where(eq(couponTemplates.couponTemplateId, couponTemplateId));
  if (!row) {
    return null;
  }
  const featureRows = await db
    .select()
    .from(couponTemplateFeaturesGranted)
    .where(
      eq(couponTemplateFeaturesGranted.couponTemplateId, couponTemplateId),
    );
  const creditRows = await db
    .select()
    .from(couponTemplateCreditsGranted)
    .where(eq(couponTemplateCreditsGranted.couponTemplateId, couponTemplateId));
  return {
    couponTemplateId: row.couponTemplateId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
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
    reciprocalBenefitCouponTemplateId: row.reciprocalBenefitCouponTemplateId,
  };
}

export async function listCouponTemplates(): Promise<CouponTemplateApi[]> {
  const rows = await db.select().from(couponTemplates);
  const found = await Promise.all(
    rows.map((row) =>
      getCouponTemplate({ couponTemplateId: row.couponTemplateId }),
    ),
  );
  return found.filter((template) => template !== null);
}

export async function createCouponTemplate({
  template,
}: {
  template: CouponTemplateCreateBody;
}): Promise<CouponTemplateApi> {
  const couponTemplateId = generateId({ prefix: "coupon_template" });
  await db
    .insert(couponTemplates)
    .values({
      couponTemplateId,
      createdAt: Date.now(),
      deprecatedAt: null,
      grantableByTenants: template.grantableByTenants,
      limitPerGrantingTenant: template.limitPerGrantingTenant,
      name: template.name,
      description: template.description,
      defaultAward: template.defaultAward
        ? await resolveAward(template.defaultAward)
        : null,
      reciprocalBenefitCouponTemplateId:
        template.reciprocalBenefitCouponTemplateId,
    })
    .onConflictDoNothing();
  if (template.featuresGranted) {
    for (const feature of template.featuresGranted) {
      await db
        .insert(couponTemplateFeaturesGranted)
        .values({
          couponTemplateId,
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
        .insert(couponTemplateCreditsGranted)
        .values({
          couponTemplateId,
          meterId: credit.meterId,
          amountMicrocredits: credit.amountMicrocredits,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: await resolveAward(credit.award),
        })
        .onConflictDoNothing();
    }
  }
  // The template row always exists once its id is stored.
  return getCouponTemplate({ couponTemplateId }) as Promise<CouponTemplateApi>;
}

/** Deprecate the template, or return null if no such template exists. */
export async function deprecateCouponTemplate({
  couponTemplateId,
}: {
  couponTemplateId: string;
}): Promise<CouponTemplateApi | null> {
  const updated = await db
    .update(couponTemplates)
    .set({ deprecatedAt: Date.now() })
    .where(eq(couponTemplates.couponTemplateId, couponTemplateId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getCouponTemplate({ couponTemplateId });
}
