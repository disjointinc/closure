import { Field, NumberInput, TextInput } from "./fields.tsx";
import { IdSelect } from "./pickers.tsx";
import { FeatureSetToField } from "./feature-set-to.tsx";
import {
  AwardField,
  defaultAwardDraft,
  resolveAwardDraft,
  type AwardDraft,
} from "./award-form.tsx";
import {
  ResetInput,
  resetToApi,
  type ResetScheduleValue,
} from "./subforms.tsx";
import { useFeatures, useMeters } from "../../lib/queries.ts";
import type { AwardInput } from "../../../../api/v0/award/service.ts";

/**
 * The shared coupon definition editor used by coupon templates and by
 * inline coupon creation. (The resolved shapes differ only in the
 * reciprocal-benefit field name, handled by the caller.)
 */
export type CouponDefDraft = {
  grantable_by_tenants: boolean;
  limit_per_granting_tenant: number | null;
  name: string;
  description: string;
  has_default_award: boolean;
  default_award: AwardDraft;
  features_granted: {
    feature: string;
    value: boolean | string[];
    award: AwardDraft;
  }[];
  credits_granted: {
    meter: string;
    amount: number | null;
    expiration: ResetScheduleValue;
    unlimitedRollovers: boolean;
    rollovers: number | null;
    award: AwardDraft;
  }[];
  /** The reciprocal benefit's id (template id or coupon id, per caller). */
  reciprocal: string;
};

export function emptyCouponDef(): CouponDefDraft {
  return {
    grantable_by_tenants: false,
    limit_per_granting_tenant: null,
    name: "",
    description: "",
    has_default_award: false,
    default_award: defaultAwardDraft(),
    features_granted: [],
    credits_granted: [],
    reciprocal: "",
  };
}

export function resolveCouponDef({ draft }: { draft: CouponDefDraft }): {
  grantable_by_tenants: boolean;
  limit_per_granting_tenant: number | null;
  name: string;
  description: string | null;
  default_award: AwardInput | null;
  features_granted:
    { feature: string; value: boolean | string[]; award: AwardInput }[] | null;
  credits_granted:
    | {
        meter: string;
        amount: number;
        expiration: ReturnType<typeof resetToApi>;
        rollovers: number | null;
        award: AwardInput;
      }[]
    | null;
  reciprocal: string | null;
} {
  if (draft.name.trim() === "") {
    throw new Error("name is required");
  }
  return {
    grantable_by_tenants: draft.grantable_by_tenants,
    limit_per_granting_tenant: draft.grantable_by_tenants
      ? draft.limit_per_granting_tenant
      : null,
    name: draft.name,
    description: draft.description === "" ? null : draft.description,
    default_award: draft.has_default_award
      ? resolveAwardDraft({ draft: draft.default_award })
      : null,
    features_granted:
      draft.features_granted.length === 0
        ? null
        : draft.features_granted.map((feature) => ({
            feature: feature.feature,
            value: feature.value,
            award: resolveAwardDraft({ draft: feature.award }),
          })),
    credits_granted:
      draft.credits_granted.length === 0
        ? null
        : draft.credits_granted.map((credit) => {
            if (credit.amount === null || credit.amount <= 0) {
              throw new Error("credits granted: amount must be positive");
            }
            return {
              meter: credit.meter,
              amount: credit.amount,
              expiration: resetToApi(credit.expiration),
              rollovers: credit.unlimitedRollovers ? null : credit.rollovers,
              award: resolveAwardDraft({ draft: credit.award }),
            };
          }),
    reciprocal:
      draft.grantable_by_tenants && draft.reciprocal !== ""
        ? draft.reciprocal
        : null,
  };
}

export function CouponDefForm({
  onChange,
  reciprocalLabel,
  value,
}: {
  onChange: (value: CouponDefDraft) => void;
  reciprocalLabel: string;
  value: CouponDefDraft;
}) {
  const features = useFeatures();
  const meters = useMeters();
  const set = (patch: Partial<CouponDefDraft>) =>
    onChange({ ...value, ...patch });
  return (
    <div>
      <div className="row">
        <Field label="Name">
          <TextInput value={value.name} onChange={(name) => set({ name })} />
        </Field>
        <Field label="Description">
          <TextInput
            value={value.description}
            onChange={(description) => set({ description })}
          />
        </Field>
      </div>

      <Field label="Default award">
        <div className="row">
          <label className="checkrow shrink">
            <input
              type="checkbox"
              checked={value.has_default_award}
              onChange={(event) =>
                set({ has_default_award: event.target.checked })
              }
            />
            <span>has default award</span>
          </label>
        </div>
        {value.has_default_award ? (
          <div style={{ marginTop: 8 }}>
            <AwardField
              value={value.default_award}
              onChange={(default_award) => set({ default_award })}
            />
          </div>
        ) : null}
      </Field>

      <div className="field">
        <label>Features granted</label>
        {value.features_granted.map((entry, index) => (
          <div className="subform" key={index}>
            <div className="subform-head">
              <span>Feature {index + 1}</span>
              <button
                type="button"
                className="link"
                onClick={() =>
                  set({
                    features_granted: value.features_granted.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              >
                remove
              </button>
            </div>
            <div className="row">
              <Field label="Feature">
                <IdSelect
                  placeholder="select a feature"
                  value={entry.feature}
                  onChange={(feature) =>
                    set({
                      features_granted: value.features_granted.map((f, i) =>
                        i === index ? { ...f, feature } : f,
                      ),
                    })
                  }
                  options={(features.data ?? []).map((feature) => ({
                    id: feature.unique_id,
                    label: feature.name,
                  }))}
                />
              </Field>
              <Field label="Set to">
                <FeatureSetToField
                  featureId={entry.feature}
                  value={entry.value}
                  onChange={(v) =>
                    set({
                      features_granted: value.features_granted.map((f, i) =>
                        i === index ? { ...f, value: v } : f,
                      ),
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Award">
              <AwardField
                value={entry.award}
                onChange={(award) =>
                  set({
                    features_granted: value.features_granted.map((f, i) =>
                      i === index ? { ...f, award } : f,
                    ),
                  })
                }
              />
            </Field>
          </div>
        ))}
        <button
          type="button"
          className="small"
          onClick={() =>
            set({
              features_granted: [
                ...value.features_granted,
                {
                  feature: "",
                  value: true,
                  award: defaultAwardDraft(),
                },
              ],
            })
          }
        >
          Add granted feature
        </button>
      </div>

      <div className="field">
        <label>Credits granted</label>
        {value.credits_granted.map((entry, index) => (
          <div className="subform" key={index}>
            <div className="subform-head">
              <span>Credit {index + 1}</span>
              <button
                type="button"
                className="link"
                onClick={() =>
                  set({
                    credits_granted: value.credits_granted.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              >
                remove
              </button>
            </div>
            <div className="row">
              <Field label="Meter">
                <IdSelect
                  placeholder="select a meter"
                  value={entry.meter}
                  onChange={(meter) =>
                    set({
                      credits_granted: value.credits_granted.map((c, i) =>
                        i === index ? { ...c, meter } : c,
                      ),
                    })
                  }
                  options={(meters.data ?? []).map((meter) => ({
                    id: meter.unique_id,
                    label: meter.name,
                  }))}
                />
              </Field>
              <Field label="Amount (microcredits)">
                <NumberInput
                  value={entry.amount}
                  onChange={(amount) =>
                    set({
                      credits_granted: value.credits_granted.map((c, i) =>
                        i === index ? { ...c, amount } : c,
                      ),
                    })
                  }
                />
              </Field>
            </div>
            <div className="row">
              <Field label="Expiration">
                <ResetInput
                  value={entry.expiration}
                  onChange={(expiration) =>
                    set({
                      credits_granted: value.credits_granted.map((c, i) =>
                        i === index ? { ...c, expiration } : c,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Rollovers">
                <div className="row">
                  <label className="checkrow shrink">
                    <input
                      type="checkbox"
                      checked={entry.unlimitedRollovers}
                      onChange={(event) =>
                        set({
                          credits_granted: value.credits_granted.map((c, i) =>
                            i === index
                              ? {
                                  ...c,
                                  unlimitedRollovers: event.target.checked,
                                }
                              : c,
                          ),
                        })
                      }
                    />
                    <span>unlimited</span>
                  </label>
                  {entry.unlimitedRollovers ? null : (
                    <NumberInput
                      value={entry.rollovers}
                      onChange={(rollovers) =>
                        set({
                          credits_granted: value.credits_granted.map((c, i) =>
                            i === index ? { ...c, rollovers } : c,
                          ),
                        })
                      }
                    />
                  )}
                </div>
              </Field>
            </div>
            <Field label="Award">
              <AwardField
                value={entry.award}
                onChange={(award) =>
                  set({
                    credits_granted: value.credits_granted.map((c, i) =>
                      i === index ? { ...c, award } : c,
                    ),
                  })
                }
              />
            </Field>
          </div>
        ))}
        <button
          type="button"
          className="small"
          onClick={() =>
            set({
              credits_granted: [
                ...value.credits_granted,
                {
                  meter: "",
                  amount: null,
                  expiration: { kind: "never" },
                  unlimitedRollovers: true,
                  rollovers: null,
                  award: defaultAwardDraft(),
                },
              ],
            })
          }
        >
          Add granted credit
        </button>
      </div>

      <Field label="Grantable by tenants">
        <div className="checkrow">
          <input
            type="checkbox"
            checked={value.grantable_by_tenants}
            onChange={(event) =>
              set({ grantable_by_tenants: event.target.checked })
            }
          />
          <span>tenants can grant this coupon to other tenants</span>
        </div>
      </Field>
      {value.grantable_by_tenants ? (
        <div className="row">
          <Field label="Limit per granting tenant (empty = no limit)">
            <NumberInput
              value={value.limit_per_granting_tenant}
              onChange={(limit_per_granting_tenant) =>
                set({ limit_per_granting_tenant })
              }
            />
          </Field>
          <Field label={reciprocalLabel}>
            <TextInput
              mono
              value={value.reciprocal}
              onChange={(reciprocal) => set({ reciprocal })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
