import { Field, NumberInput } from "./fields.tsx";
import { IdSelect } from "./pickers.tsx";
import {
  ResetInput,
  resetToApi,
  type ResetScheduleValue,
} from "./subforms.tsx";
import { useMeters } from "../../lib/queries.ts";

/**
 * The plan-meter entry editor shared by the plan form and meter overrides.
 * Top-up pricing is omitted (API-only for now), so entries submit nulls.
 */
export type MeterEntryDraft = {
  meter: string;
  default: number | null;
  unlimited: boolean;
  limit: number | null;
  reset: ResetScheduleValue;
  unlimitedRollovers: boolean;
  rollovers: number | null;
};

export function emptyMeterEntry(): MeterEntryDraft {
  return {
    meter: "",
    default: 0,
    unlimited: true,
    limit: null,
    reset: { kind: "never" },
    unlimitedRollovers: true,
    rollovers: null,
  };
}

export function resolveMeterEntry({ draft }: { draft: MeterEntryDraft }): {
  meter: string;
  default: number;
  limit: number | null;
  reset: ReturnType<typeof resetToApi>;
  rollovers: number | null;
  top_up_prices_per_credit: null;
  top_up_credit_pack_sizes: null;
} {
  if (draft.meter === "") {
    throw new Error("meter entry: select a meter");
  }
  if (draft.default === null || draft.default < 0) {
    throw new Error("meter entry: default allocation must be >= 0");
  }
  return {
    meter: draft.meter,
    default: draft.default,
    limit: draft.unlimited ? null : draft.limit,
    reset: resetToApi(draft.reset),
    rollovers: draft.unlimitedRollovers ? null : draft.rollovers,
    top_up_prices_per_credit: null,
    top_up_credit_pack_sizes: null,
  };
}

export function MeterEntryFields({
  onChange,
  value,
}: {
  onChange: (value: MeterEntryDraft) => void;
  value: MeterEntryDraft;
}) {
  const meters = useMeters();
  const set = (patch: Partial<MeterEntryDraft>) =>
    onChange({ ...value, ...patch });
  return (
    <div>
      <Field label="Meter">
        <IdSelect
          placeholder="select a meter"
          value={value.meter}
          onChange={(meter) => set({ meter })}
          options={(meters.data ?? []).map((meter) => ({
            id: meter.unique_id,
            label: meter.name,
          }))}
        />
      </Field>
      <div className="row">
        <Field label="Default allocation (microcredits)">
          <NumberInput
            value={value.default}
            onChange={(n) => set({ default: n })}
          />
        </Field>
        <Field label="Limit">
          <div className="row">
            <label className="checkrow shrink">
              <input
                type="checkbox"
                checked={value.unlimited}
                onChange={(event) => set({ unlimited: event.target.checked })}
              />
              <span>unlimited</span>
            </label>
            {value.unlimited ? null : (
              <NumberInput
                value={value.limit}
                onChange={(limit) => set({ limit })}
              />
            )}
          </div>
        </Field>
      </div>
      <div className="row">
        <Field label="Reset">
          <ResetInput
            value={value.reset}
            onChange={(reset) => set({ reset })}
          />
        </Field>
        <Field label="Rollovers">
          <div className="row">
            <label className="checkrow shrink">
              <input
                type="checkbox"
                checked={value.unlimitedRollovers}
                onChange={(event) =>
                  set({ unlimitedRollovers: event.target.checked })
                }
              />
              <span>unlimited</span>
            </label>
            {value.unlimitedRollovers ? null : (
              <NumberInput
                value={value.rollovers}
                onChange={(rollovers) => set({ rollovers })}
              />
            )}
          </div>
        </Field>
      </div>
    </div>
  );
}
