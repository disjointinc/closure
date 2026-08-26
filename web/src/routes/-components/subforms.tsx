import { z } from "zod";
import { valueSchema, type Value } from "../../../../api/schemas/value.ts";
import { generateId } from "../../lib/ids.ts";
import { looksLikeId } from "../../lib/api.ts";
import { Field, NumberInput, TextInput } from "./fields.tsx";
import { RefPicker } from "./pickers.tsx";

export type DurationValue =
  | { kind: "days"; days: number | null }
  | { kind: "months"; months: number | null }
  | { kind: "one-time" }
  | { kind: "billing_cycle_end" };

/** Duration editor used wherever a { days } / { months } duration appears. */
export function DurationInput({
  onChange,
  units,
  value,
}: {
  onChange: (value: DurationValue) => void;
  units: ("days" | "months" | "one-time" | "billing_cycle_end")[];
  value: DurationValue;
}) {
  return (
    <div className="row">
      <select
        className="shrink"
        value={value.kind}
        onChange={(event) => {
          const kind = event.target.value as DurationValue["kind"];
          if (kind === "days") {
            onChange({ kind: "days", days: 30 });
          } else if (kind === "months") {
            onChange({ kind: "months", months: 1 });
          } else {
            onChange({ kind });
          }
        }}
      >
        {units.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
      {value.kind === "days" || value.kind === "months" ? (
        <NumberInput
          value={value.kind === "days" ? value.days : value.months}
          onChange={(n) =>
            onChange(
              value.kind === "days"
                ? { kind: "days", days: n }
                : { kind: "months", months: n },
            )
          }
        />
      ) : null}
    </div>
  );
}

export function durationToApi(
  value: DurationValue,
): { days: number; months: null } | { days: null; months: number } | null {
  if (value.kind === "days" && value.days !== null && value.days > 0) {
    return { days: value.days, months: null };
  }
  if (value.kind === "months" && value.months !== null && value.months > 0) {
    return { days: null, months: value.months };
  }
  return null;
}

export type ValueDef = {
  unique_id: string;
  name: string;
  description: string;
  currency: string;
  unit: string;
  amount: number | null;
};

export function emptyValueDef(): ValueDef {
  return {
    unique_id: generateId("value"),
    name: "",
    description: "",
    currency: "USD",
    unit: "cents",
    amount: null,
  };
}

/** The inline-definition half of a value ref (value objects). */
export function ValueInlineForm({
  onChange,
  value,
}: {
  onChange: (value: ValueDef) => void;
  value: ValueDef;
}) {
  const set = (patch: Partial<ValueDef>) => onChange({ ...value, ...patch });
  return (
    <div className="subform">
      <div className="row">
        <Field label="Id">
          <TextInput
            mono
            value={value.unique_id}
            onChange={(unique_id) => set({ unique_id })}
          />
        </Field>
        <Field label="Name">
          <TextInput value={value.name} onChange={(name) => set({ name })} />
        </Field>
      </div>
      <div className="row">
        <Field label="Currency">
          <TextInput
            value={value.currency}
            onChange={(currency) => set({ currency: currency.toUpperCase() })}
          />
        </Field>
        <Field label="Smallest unit (e.g. cents)">
          <TextInput value={value.unit} onChange={(unit) => set({ unit })} />
        </Field>
        <Field label="Amount (in units)">
          <NumberInput
            value={value.amount}
            onChange={(amount) => set({ amount })}
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * The raw (unvalidated) shape of an inline value definition. Forms run this
 * through valueSchema.safeParse (the API's own rules) before submitting, so
 * client and server validation never drift.
 */
export function valueDefToRaw({ def }: { def: ValueDef }) {
  return {
    unique_id: def.unique_id,
    created_at: Date.now(),
    deprecated_at: null,
    name: def.name,
    description: def.description === "" ? null : def.description,
    amounts:
      def.amount === null
        ? []
        : [{ currency: def.currency, unit: def.unit, value: def.amount }],
  };
}

// ---------------------------------------------------------------------------
// Reset schedules (a duration, "billing_cycle_end", or null for "never")
// ---------------------------------------------------------------------------

export type ResetScheduleValue =
  | { kind: "never" }
  | { kind: "billing_cycle_end" }
  | { kind: "days"; days: number | null }
  | { kind: "months"; months: number | null };

export function ResetInput({
  onChange,
  value,
}: {
  onChange: (value: ResetScheduleValue) => void;
  value: ResetScheduleValue;
}) {
  return (
    <div className="row">
      <select
        className="shrink"
        value={value.kind}
        onChange={(event) => {
          const kind = event.target.value as ResetScheduleValue["kind"];
          if (kind === "days") {
            onChange({ kind: "days", days: 30 });
          } else if (kind === "months") {
            onChange({ kind: "months", months: 1 });
          } else {
            onChange({ kind });
          }
        }}
      >
        <option value="never">never</option>
        <option value="billing_cycle_end">billing_cycle_end</option>
        <option value="days">days</option>
        <option value="months">months</option>
      </select>
      {value.kind === "days" || value.kind === "months" ? (
        <NumberInput
          value={value.kind === "days" ? value.days : value.months}
          onChange={(n) =>
            onChange(
              value.kind === "days"
                ? { kind: "days", days: n }
                : { kind: "months", months: n },
            )
          }
        />
      ) : null}
    </div>
  );
}

export function resetToApi(
  value: ResetScheduleValue,
):
  | "billing_cycle_end"
  | { days: number; months: null }
  | { days: null; months: number }
  | null {
  if (value.kind === "never") {
    return null;
  }
  if (value.kind === "billing_cycle_end") {
    return "billing_cycle_end";
  }
  if (value.kind === "days") {
    return value.days !== null && value.days > 0
      ? { days: value.days, months: null }
      : null;
  }
  return value.months !== null && value.months > 0
    ? { days: null, months: value.months }
    : null;
}

/** Validate an inline value definition with the API's own schema. */
export function parseValueDef({ def }: { def: ValueDef }): Value {
  const parsed = valueSchema.safeParse(valueDefToRaw({ def }));
  if (!parsed.success) {
    throw new Error(`inline value: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Value references (existing id or inline definition)
// ---------------------------------------------------------------------------

export type ValueRefDraft =
  { kind: "existing"; id: string } | { kind: "inline"; inline: ValueDef };

export function emptyValueRef(): ValueRefDraft {
  return { kind: "existing", id: "" };
}

export function ValueRefField({
  onChange,
  value,
}: {
  onChange: (value: ValueRefDraft) => void;
  value: ValueRefDraft;
}) {
  return (
    <div>
      <RefPicker
        kind={value.kind}
        idValue={value.kind === "existing" ? value.id : ""}
        onKindChange={(kind) =>
          onChange(
            kind === "inline"
              ? { kind: "inline", inline: emptyValueDef() }
              : { kind: "existing", id: "" },
          )
        }
        onIdChange={(id) => onChange({ kind: "existing", id })}
      />
      {value.kind === "inline" ? (
        <div style={{ marginTop: 8 }}>
          <ValueInlineForm
            value={value.inline}
            onChange={(inline) => onChange({ kind: "inline", inline })}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Resolve a value ref draft to the id or validated inline object. */
export function resolveValueRefDraft({
  draft,
}: {
  draft: ValueRefDraft;
}): string | Value {
  if (draft.kind === "inline") {
    return parseValueDef({ def: draft.inline });
  }
  const id = draft.id.trim();
  if (!looksLikeId(id)) {
    throw new Error(
      "value ref: expected an existing id or an inline definition",
    );
  }
  return id;
}
