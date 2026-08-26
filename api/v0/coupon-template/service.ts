/**
 * v0/coupon-template/service.ts -- coupon template business logic.
 * Templates are reusable coupon definitions (e.g. "the referral coupon")
 * that coupons mint from; they're deprecated, never deleted.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  couponTemplateCreditsGranted,
  couponTemplateFeaturesGranted,
  couponTemplates,
} from "../../db/schema.ts";
import type { CouponTemplate } from "../../schemas/coupon-template.ts";
import { resolveAward } from "../award/service.ts";
import type { CouponTemplateCreateBody } from "./routes.ts";

export async function getCouponTemplate({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<CouponTemplate | null> {
  const [row] = await db
    .select()
    .from(couponTemplates)
    .where(eq(couponTemplates.uniqueId, uniqueId));
  if (!row) {
    return null;
  }
  const featureRows = await db
    .select()
    .from(couponTemplateFeaturesGranted)
    .where(eq(couponTemplateFeaturesGranted.couponTemplate, uniqueId));
  const creditRows = await db
    .select()
    .from(couponTemplateCreditsGranted)
    .where(eq(couponTemplateCreditsGranted.couponTemplate, uniqueId));
  return {
    uniqueId: row.uniqueId,
    createdAt: row.createdAt,
    deprecatedAt: row.deprecatedAt,
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
    reciprocalBenefitCouponTemplate: row.reciprocalBenefitCouponTemplate,
  };
}

export async function listCouponTemplates(): Promise<CouponTemplate[]> {
  const rows = await db.select().from(couponTemplates);
  const found = await Promise.all(
    rows.map((row) => getCouponTemplate({ uniqueId: row.uniqueId })),
  );
  return found.filter((template) => template !== null);
}

export async function createCouponTemplate({
  template,
}: {
  template: CouponTemplateCreateBody;
}): Promise<CouponTemplate | null> {
  await db
    .insert(couponTemplates)
    .values({
      uniqueId: template.uniqueId,
      createdAt: template.createdAt,
      deprecatedAt: template.deprecatedAt,
      grantableByTenants: template.grantableByTenants,
      limitPerGrantingTenant: template.limitPerGrantingTenant,
      name: template.name,
      description: template.description,
      defaultAward: template.defaultAward
        ? await resolveAward(template.defaultAward)
        : null,
      reciprocalBenefitCouponTemplate: template.reciprocalBenefitCouponTemplate,
    })
    .onConflictDoNothing();
  if (template.featuresGranted) {
    for (const feature of template.featuresGranted) {
      await db
        .insert(couponTemplateFeaturesGranted)
        .values({
          couponTemplate: template.uniqueId,
          feature: feature.feature,
          value: feature.value,
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
          couponTemplate: template.uniqueId,
          meter: credit.meter,
          amountMicrocredits: credit.amount,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: await resolveAward(credit.award),
        })
        .onConflictDoNothing();
    }
  }
  return getCouponTemplate({ uniqueId: template.uniqueId });
}

/** Deprecate the template, or return null if no such template exists. */
export async function deprecateCouponTemplate({
  uniqueId,
}: {
  uniqueId: string;
}): Promise<CouponTemplate | null> {
  const updated = await db
    .update(couponTemplates)
    .set({ deprecatedAt: Date.now() })
    .where(eq(couponTemplates.uniqueId, uniqueId))
    .returning();
  if (updated.length === 0) {
    return null;
  }
  return getCouponTemplate({ uniqueId });
}
