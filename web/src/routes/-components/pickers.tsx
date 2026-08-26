import { generateId } from "../../lib/ids.ts";
import { looksLikeId } from "../../lib/api.ts";
import { TextInput } from "./fields.tsx";
import type { IdPrefix } from "../../../../api/schemas/ids.ts";

/** Id input prefilled with a generated value, with a regenerate button. */
export function IdInput({
  onChange,
  prefix,
  value,
}: {
  onChange: (value: string) => void;
  prefix: IdPrefix;
  value: string;
}) {
  return (
    <div className="row">
      <TextInput mono value={value} onChange={onChange} />
      <button
        type="button"
        className="shrink small"
        onClick={() => onChange(generateId(prefix))}
      >
        Regen
      </button>
    </div>
  );
}

export type RefValue = { kind: "existing"; id: string } | { kind: "inline" };

/**
 * A ref field: an existing object's id, or "inline" meaning the caller
 * renders definition fields below and the resolver builds the full object.
 */
export function RefPicker({
  idValue,
  kind,
  onIdChange,
  onKindChange,
}: {
  idValue: string;
  kind: RefValue["kind"];
  onIdChange: (value: string) => void;
  onKindChange: (kind: RefValue["kind"]) => void;
}) {
  return (
    <div className="row">
      <select
        className="shrink"
        value={kind}
        onChange={(event) =>
          onKindChange(event.target.value as RefValue["kind"])
        }
      >
        <option value="existing">Existing id</option>
        <option value="inline">Inline definition</option>
      </select>
      {kind === "existing" ? (
        <TextInput
          mono
          value={idValue}
          onChange={onIdChange}
          placeholder="paste or type an id"
        />
      ) : null}
    </div>
  );
}

/** Resolve a ref field to what the API expects (string id or inline). */
export function resolveRef<T>({
  idValue,
  inline,
  kind,
}: {
  idValue: string;
  inline: T | null;
  kind: RefValue["kind"];
}): string | T | null {
  if (kind === "inline") {
    return inline;
  }
  const trimmed = idValue.trim();
  if (!looksLikeId(trimmed)) {
    return null;
  }
  return trimmed;
}

/** A single-id select over an enumerable resource. */
export function IdSelect({
  onChange,
  options,
  placeholder,
  value,
}: {
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  value: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A checkbox list for picking several ids. */
export function MultiIdSelect({
  onChange,
  options,
  value,
}: {
  onChange: (ids: string[]) => void;
  options: { id: string; label: string }[];
  value: string[];
}) {
  return (
    <div className="subform" style={{ maxHeight: 160, overflowY: "auto" }}>
      {options.length === 0 ? (
        <div className="muted">Nothing to pick from yet.</div>
      ) : (
        options.map((option) => (
          <label className="checkrow" key={option.id}>
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.id]
                    : value.filter((id) => id !== option.id),
                )
              }
            />
            <span>{option.label}</span>
          </label>
        ))
      )}
    </div>
  );
}
