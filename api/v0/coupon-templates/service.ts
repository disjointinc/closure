/**
 * v0/coupon-templates/service.ts -- coupon template business logic.
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
import { resolveAward } from "../awards/service.ts";
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
    reciprocal_benefit_coupon_template: row.reciprocalBenefitCouponTemplate,
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
      uniqueId: template.unique_id,
      createdAt: template.created_at,
      deprecatedAt: template.deprecated_at,
      grantableByTenants: template.grantable_by_tenants,
      limitPerGrantingTenant: template.limit_per_granting_tenant,
      name: template.name,
      description: template.description,
      defaultAward: template.default_award
        ? await resolveAward(template.default_award)
        : null,
      reciprocalBenefitCouponTemplate:
        template.reciprocal_benefit_coupon_template,
    })
    .onConflictDoNothing();
  if (template.features_granted) {
    for (const feature of template.features_granted) {
      await db
        .insert(couponTemplateFeaturesGranted)
        .values({
          couponTemplate: template.unique_id,
          feature: feature.feature,
          value: feature.value,
          award: await resolveAward(feature.award),
        })
        .onConflictDoNothing();
    }
  }
  if (template.credits_granted) {
    for (const credit of template.credits_granted) {
      await db
        .insert(couponTemplateCreditsGranted)
        .values({
          couponTemplate: template.unique_id,
          meter: credit.meter,
          amountMicrocredits: credit.amount,
          expiration: credit.expiration,
          rollovers: credit.rollovers,
          award: await resolveAward(credit.award),
        })
        .onConflictDoNothing();
    }
  }
  return getCouponTemplate({ uniqueId: template.unique_id });
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
