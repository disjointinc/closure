import { z } from "zod";
import { cycleSchema, type Cycle } from "../../../../api/schemas/cycle.ts";
import { looksLikeId } from "../../lib/api.ts";
import { generateId } from "../../lib/ids.ts";
import { Field, TextInput } from "./fields.tsx";
import { RefPicker, IdInput } from "./pickers.tsx";
import {
  DurationInput,
  durationToApi,
  type DurationValue,
} from "./subforms.tsx";

export type CycleDef = {
  unique_id: string;
  name: string;
  description: string;
  charged: "upfront" | "arrears";
  cycle_length: DurationValue;
  credit_period: DurationValue;
  grace_enabled: boolean;
  grace_period: DurationValue;
  /** JSON: [{ after: Duration, actions: DunningAction[] }] (arrears only). */
  dunning_schedule: string;
};

export function emptyCycleDef(): CycleDef {
  return {
    unique_id: generateId("cycle"),
    name: "",
    description: "",
    charged: "upfront",
    cycle_length: { kind: "months", months: 1 },
    credit_period: { kind: "days", days: 7 },
    grace_enabled: false,
    grace_period: { kind: "days", days: 3 },
    dunning_schedule: "[]",
  };
}

/** The inline-definition half of a cycle ref. */
export function CycleInlineForm({
  onChange,
  value,
}: {
  onChange: (value: CycleDef) => void;
  value: CycleDef;
}) {
  const set = (patch: Partial<CycleDef>) => onChange({ ...value, ...patch });
  return (
    <div className="subform">
      <div className="row">
        <Field label="Id">
          <IdInput
            prefix="cycle"
            value={value.unique_id}
            onChange={(unique_id) => set({ unique_id })}
          />
        </Field>
        <Field label="Name">
          <TextInput value={value.name} onChange={(name) => set({ name })} />
        </Field>
      </div>
      <Field label="Description">
        <TextInput
          value={value.description}
          onChange={(description) => set({ description })}
        />
      </Field>
      <div className="row">
        <Field label="Charged">
          <select
            value={value.charged}
            onChange={(event) =>
              set({ charged: event.target.value as CycleDef["charged"] })
            }
          >
            <option value="upfront">upfront</option>
            <option value="arrears">arrears</option>
          </select>
        </Field>
        <Field label="Cycle length">
          <DurationInput
            units={
              value.charged === "upfront"
                ? ["months", "days", "one-time"]
                : ["months", "days"]
            }
            value={value.cycle_length}
            onChange={(cycle_length) => set({ cycle_length })}
          />
        </Field>
      </div>
      {value.charged === "arrears" ? (
        <>
          <div className="row">
            <Field label="Credit period">
              <DurationInput
                units={["days", "months"]}
                value={value.credit_period}
                onChange={(credit_period) => set({ credit_period })}
              />
            </Field>
            <Field label="Grace period">
              <div className="row">
                <label className="checkrow shrink">
                  <input
                    type="checkbox"
                    checked={value.grace_enabled}
                    onChange={(event) =>
                      set({ grace_enabled: event.target.checked })
                    }
                  />
                  <span>enabled</span>
                </label>
                {value.grace_enabled ? (
                  <DurationInput
                    units={["days", "months"]}
                    value={value.grace_period}
                    onChange={(grace_period) => set({ grace_period })}
                  />
                ) : null}
              </div>
            </Field>
          </div>
          <Field
            label="Dunning schedule (JSON)"
            hint='[{"after": {"days": 7, "months": null}, "actions": [{"type": "retry_customer", "notes": "..."}]}]'
          >
            <textarea
              className="mono"
              rows={3}
              value={value.dunning_schedule}
              onChange={(event) =>
                set({ dunning_schedule: event.target.value })
              }
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

/** Validate an inline cycle definition with the API's own schema. */
export function parseCycleDef({ def }: { def: CycleDef }): Cycle {
  let dunning: unknown = [];
  if (def.charged === "arrears") {
    try {
      dunning = JSON.parse(def.dunning_schedule || "[]");
    } catch {
      throw new Error("dunning schedule: invalid JSON");
    }
  }
  const base = {
    unique_id: def.unique_id,
    created_at: Date.now(),
    deprecated_at: null,
    name: def.name,
    description: def.description === "" ? null : def.description,
  };
  const raw =
    def.charged === "upfront"
      ? {
          ...base,
          charged: "upfront",
          cycle_length:
            def.cycle_length.kind === "one-time"
              ? "one-time"
              : durationToApi(def.cycle_length),
        }
      : {
          ...base,
          charged: "arrears",
          cycle_length: durationToApi(def.cycle_length),
          credit_period: durationToApi(def.credit_period),
          grace_period: def.grace_enabled
            ? durationToApi(def.grace_period)
            : null,
          dunning_schedule: dunning,
        };
  const parsed = cycleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`inline cycle: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Cycle references (existing id or inline definition)
// ---------------------------------------------------------------------------

export type CycleRefDraft =
  { kind: "existing"; id: string } | { kind: "inline"; inline: CycleDef };

export function emptyCycleRef(): CycleRefDraft {
  return { kind: "existing", id: "" };
}

export function CycleRefField({
  onChange,
  value,
}: {
  onChange: (value: CycleRefDraft) => void;
  value: CycleRefDraft;
}) {
  return (
    <div>
      <RefPicker
        kind={value.kind}
        idValue={value.kind === "existing" ? value.id : ""}
        onKindChange={(kind) =>
          onChange(
            kind === "inline"
              ? { kind: "inline", inline: emptyCycleDef() }
              : { kind: "existing", id: "" },
          )
        }
        onIdChange={(id) => onChange({ kind: "existing", id })}
      />
      {value.kind === "inline" ? (
        <div style={{ marginTop: 8 }}>
          <CycleInlineForm
            value={value.inline}
            onChange={(inline) => onChange({ kind: "inline", inline })}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Resolve a cycle ref draft to the id or validated inline object. */
export function resolveCycleRefDraft({
  draft,
}: {
  draft: CycleRefDraft;
}): string | Cycle {
  if (draft.kind === "inline") {
    return parseCycleDef({ def: draft.inline });
  }
  const id = draft.id.trim();
  if (!looksLikeId(id)) {
    throw new Error(
      "cycle ref: expected an existing id or an inline definition",
    );
  }
  return id;
}
