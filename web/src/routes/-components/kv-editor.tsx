import { useState } from "react";
import { Field } from "./fields.tsx";

/** Key-value editor for external_ids-style records. */
export function KeyValueEditor({
  onChange,
  value,
}: {
  onChange: (value: Record<string, string>) => void;
  value: Record<string, string>;
}) {
  const entries = Object.entries(value);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  return (
    <div>
      {entries.map(([key, val]) => (
        <div className="row" key={key} style={{ marginBottom: 6 }}>
          <code className="mono">{key}</code>
          <span>{val}</span>
          <button
            type="button"
            className="link shrink"
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
          >
            remove
          </button>
        </div>
      ))}
      <div className="row">
        <Field label="System (e.g. stripe)">
          <input
            type="text"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          />
        </Field>
        <Field label="Id in that system">
          <input
            type="text"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
          />
        </Field>
        <button
          type="button"
          className="small shrink"
          disabled={draftKey.trim() === "" || draftValue.trim() === ""}
          onClick={() => {
            onChange({ ...value, [draftKey.trim()]: draftValue.trim() });
            setDraftKey("");
            setDraftValue("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
