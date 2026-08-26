import type { ReactNode } from "react";

export function Field({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function CheckField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="field">
      <div className="checkrow">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function TextInput({
  mono,
  onChange,
  placeholder,
  value,
}: {
  mono?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <input
      type="text"
      className={mono ? "mono" : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Integer input; commits null when blank and clamps to >= 1. */
export function NumberInput({
  onChange,
  signed,
  value,
}: {
  onChange: (value: number | null) => void;
  signed?: boolean;
  value: number | null;
}) {
  return (
    <input
      type="number"
      min={signed ? undefined : 1}
      value={value ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (Number.isInteger(parsed)) {
          onChange(parsed);
        }
      }}
    />
  );
}

/** A datetime-local input editing epoch milliseconds (null = unset). */
export function DateTimeInput({
  onChange,
  value,
}: {
  onChange: (value: number | null) => void;
  value: number | null;
}) {
  return (
    <input
      type="datetime-local"
      value={value === null ? "" : new Date(value).toISOString().slice(0, 16)}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === "" ? null : new Date(raw).getTime());
      }}
    />
  );
}
