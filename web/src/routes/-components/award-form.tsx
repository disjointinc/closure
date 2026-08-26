import type { AwardInput } from "../../../../api/v0/award/service.ts";
import { NumberInput } from "./fields.tsx";
import {
  emptyValueRef,
  resolveValueRefDraft,
  ValueRefField,
  type ValueRefDraft,
} from "./subforms.tsx";

/** An award draft: percentage discount, or a value ref for the other two. */
export type AwardDraft =
  | { type: "percentage_discount"; value: number | null }
  | { type: "payout" | "flat_discount"; value: ValueRefDraft };

export function defaultAwardDraft(): AwardDraft {
  return { type: "percentage_discount", value: 100 };
}

export function AwardField({
  onChange,
  value,
}: {
  onChange: (value: AwardDraft) => void;
  value: AwardDraft;
}) {
  return (
    <div>
      <div className="row">
        <select
          className="shrink"
          value={value.type}
          onChange={(event) => {
            const type = event.target.value as AwardDraft["type"];
            onChange(
              type === "percentage_discount"
                ? { type, value: 100 }
                : { type, value: emptyValueRef() },
            );
          }}
        >
          <option value="percentage_discount">percentage_discount</option>
          <option value="payout">payout</option>
          <option value="flat_discount">flat_discount</option>
        </select>
        {value.type === "percentage_discount" ? (
          <NumberInput
            value={value.value}
            onChange={(v) => onChange({ type: value.type, value: v })}
          />
        ) : null}
      </div>
      {value.type !== "percentage_discount" ? (
        <div style={{ marginTop: 8 }}>
          <ValueRefField
            value={value.value}
            onChange={(v) => onChange({ type: value.type, value: v })}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Resolve an award draft to the API's award input shape. */
export function resolveAwardDraft({
  draft,
}: {
  draft: AwardDraft;
}): AwardInput {
  if (draft.type === "percentage_discount") {
    if (draft.value === null || draft.value <= 0 || draft.value > 100) {
      throw new Error("award: percentage must be between 0 and 100");
    }
    return { type: "percentage_discount", value: draft.value };
  }
  return {
    type: draft.type,
    value: resolveValueRefDraft({ draft: draft.value }),
  };
}
