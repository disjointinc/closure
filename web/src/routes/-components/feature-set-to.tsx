import { useFeatures } from "../../lib/queries.ts";

/**
 * The set_to editor for a feature entry: a boolean checkbox for boolean
 * features, a checkbox list of option names for enumerated ones.
 */
export function FeatureSetToField({
  featureId,
  onChange,
  value,
}: {
  featureId: string;
  onChange: (value: boolean | string[]) => void;
  value: boolean | string[];
}) {
  const features = useFeatures();
  const feature = (features.data ?? []).find((f) => f.unique_id === featureId);
  if (!feature || !feature.options) {
    return (
      <label className="checkrow">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>enabled</span>
      </label>
    );
  }
  const selected = Array.isArray(value) ? value : [];
  return (
    <div>
      {feature.options.map((option) => (
        <label className="checkrow" key={option.unique_id}>
          <input
            type="checkbox"
            checked={selected.includes(option.name)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, option.name]
                  : selected.filter((name) => name !== option.name),
              )
            }
          />
          <span>{option.name}</span>
        </label>
      ))}
    </div>
  );
}
