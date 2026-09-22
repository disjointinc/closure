/**
 * v0/coupon-template/service.ts -- coupon template business logic.
 * Templates are reusable coupon definitions (e.g. "the referral coupon")
 * that coupons mint from; they're deprecated, never deleted. Award amounts
 * are stored inline.
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

/** The create-input template: microcredits, awards as full values. */
export type CouponTemplateCreateBody = Omit<
  CouponTemplateApi,
  "couponTemplateId" | "createdAt" | "deprecatedAt"
>;

export type CouponTemplateApi = Omit<
  CouponTemplate,
  "defaultAward" | "featuresGranted" | "creditsGranted"
> & {
  defaultAward: Award | null;
  featuresGranted: CouponTemplate["featuresGranted"];
  creditsGranted: CouponTemplate["creditsGranted"];
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
      defaultAward: template.defaultAward,
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
          award: feature.award,
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
          award: credit.award,
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
