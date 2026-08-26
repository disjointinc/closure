import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { PlanCreateBody } from "../../../api/v0/plan/routes.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field, TextInput } from "./-components/fields.tsx";
import { FeatureSetToField } from "./-components/feature-set-to.tsx";
import { IdInput, IdSelect, MultiIdSelect } from "./-components/pickers.tsx";
import {
  emptyCycleRef,
  resolveCycleRefDraft,
  CycleRefField,
  type CycleRefDraft,
} from "./-components/cycle-form.tsx";
import {
  emptyMeterEntry,
  MeterEntryFields,
  resolveMeterEntry,
  type MeterEntryDraft,
} from "./-components/meter-entry-form.tsx";
import {
  emptyValueRef,
  resolveValueRefDraft,
  ValueRefField,
  type ValueRefDraft,
} from "./-components/subforms.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import { useAddOns, useFeatures, usePlans } from "../lib/queries.ts";

export const Route = createFileRoute("/plans")({
  component: PlansPage,
});

type PriceDraft = { cycle: CycleRefDraft; value: ValueRefDraft };
type FeatureDraft = { feature: string; set_to: boolean | string[] };

const emptyForm = () => ({
  unique_id: generateId("plan"),
  derived_from: "",
  name: "",
  description: "",
  prices: [] as PriceDraft[],
  features: [] as FeatureDraft[],
  meters: [] as MeterEntryDraft[],
  add_ons: [] as string[],
});

function PlansPage() {
  const queryClient = useQueryClient();
  const plans = usePlans();
  const addOns = useAddOns();
  const features = useFeatures();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: PlanCreateBody = {
        unique_id: form.unique_id,
        derived_from: form.derived_from === "" ? null : form.derived_from,
        created_at: Date.now(),
        deprecated_at: null,
        name: form.name,
        description: form.description === "" ? null : form.description,
        prices: form.prices.map((price) => ({
          cycle: resolveCycleRefDraft({ draft: price.cycle }),
          value: resolveValueRefDraft({ draft: price.value }),
        })),
        features:
          form.features.length === 0
            ? null
            : form.features.map((feature) => ({
                feature: feature.feature,
                set_to: feature.set_to,
              })),
        meters:
          form.meters.length === 0
            ? null
            : form.meters.map((meter) => resolveMeterEntry({ draft: meter })),
        add_ons: form.add_ons.length === 0 ? null : form.add_ons,
      };
      return unwrap(api.v0.plan.$post({ json: body }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data?.unique_id ?? "(see list)"}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["plan"] });
      void queryClient.invalidateQueries({ queryKey: ["cycle"] });
      void queryClient.invalidateQueries({ queryKey: ["value"] });
    },
    onError: (mutationError) => {
      setCreated(null);
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError),
      );
    },
  });

  const deprecate = useMutation({
    mutationFn: (uniqueId: string) =>
      unwrap(api.v0.plan[":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["plan"] }),
  });

  return (
    <Page
      title="Plans"
      sub="Versioned pricing definitions. Immutable; deleting deprecates. New versions reference their parent via derived_from."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          {
            header: "Derived from",
            cell: (row) =>
              row.derived_from ? <IdCell id={row.derived_from} /> : "—",
          },
          { header: "Prices", cell: (row) => row.prices.length },
          { header: "Features", cell: (row) => row.features?.length ?? 0 },
          { header: "Meters", cell: (row) => row.meters?.length ?? 0 },
          { header: "Add-ons", cell: (row) => row.add_ons?.length ?? 0 },
          {
            header: "Status",
            cell: (row) =>
              row.deprecated_at ? (
                <span className="pill warn">deprecated</span>
              ) : (
                <span className="pill ok">active</span>
              ),
          },
          {
            header: "Created",
            cell: (row) => fmtTimestamp(row.created_at),
          },
          {
            header: "",
            cell: (row) =>
              row.deprecated_at ? null : (
                <button
                  className="danger small"
                  onClick={(event) => {
                    event.stopPropagation();
                    deprecate.mutate(row.unique_id);
                  }}
                >
                  Deprecate
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No plans yet."
        keyOf={(row) => row.unique_id}
        rows={plans.data ?? []}
      />

      <div className="panel">
        <h2>Create plan</h2>
        <Field label="Id">
          <IdInput
            prefix="plan"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
            />
          </Field>
          <Field label="Description">
            <TextInput
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
            />
          </Field>
        </div>
        <Field
          label="Derived from"
          hint="Set when this plan is a new version of an existing one."
        >
          <IdSelect
            placeholder="none"
            value={form.derived_from}
            onChange={(derived_from) => setForm({ ...form, derived_from })}
            options={(plans.data ?? []).map((plan) => ({
              id: plan.unique_id,
              label: `${plan.name} (${plan.unique_id})`,
            }))}
          />
        </Field>

        <div className="field">
          <label>Prices</label>
          {form.prices.map((price, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Price {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      prices: form.prices.filter((_, i) => i !== index),
                    })
                  }
                >
                  remove
                </button>
              </div>
              <Field label="Cycle">
                <CycleRefField
                  value={price.cycle}
                  onChange={(cycle) =>
                    setForm({
                      ...form,
                      prices: form.prices.map((p, i) =>
                        i === index ? { ...p, cycle } : p,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Value">
                <ValueRefField
                  value={price.value}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      prices: form.prices.map((p, i) =>
                        i === index ? { ...p, value } : p,
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
              setForm({
                ...form,
                prices: [
                  ...form.prices,
                  { cycle: emptyCycleRef(), value: emptyValueRef() },
                ],
              })
            }
          >
            Add price
          </button>
        </div>

        <div className="field">
          <label>Features</label>
          {form.features.map((entry, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Feature {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      features: form.features.filter((_, i) => i !== index),
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
                      setForm({
                        ...form,
                        features: form.features.map((f, i) =>
                          i === index ? { feature, set_to: true } : f,
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
                    value={entry.set_to}
                    onChange={(set_to) =>
                      setForm({
                        ...form,
                        features: form.features.map((f, i) =>
                          i === index ? { ...f, set_to } : f,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() =>
              setForm({
                ...form,
                features: [...form.features, { feature: "", set_to: true }],
              })
            }
          >
            Add feature
          </button>
        </div>

        <div className="field">
          <label>
            Meters{" "}
            <span className="hint">
              (top-up pricing configurable via the API)
            </span>
          </label>
          {form.meters.map((meter, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Meter {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      meters: form.meters.filter((_, i) => i !== index),
                    })
                  }
                >
                  remove
                </button>
              </div>
              <MeterEntryFields
                value={meter}
                onChange={(draft) =>
                  setForm({
                    ...form,
                    meters: form.meters.map((entry, i) =>
                      i === index ? draft : entry,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() =>
              setForm({ ...form, meters: [...form.meters, emptyMeterEntry()] })
            }
          >
            Add meter
          </button>
        </div>

        <Field label="Add-ons">
          <MultiIdSelect
            value={form.add_ons}
            onChange={(add_ons) => setForm({ ...form, add_ons })}
            options={(addOns.data ?? []).map((addOn) => ({
              id: addOn.unique_id,
              label: `${addOn.name} (${addOn.unique_id})`,
            }))}
          />
        </Field>

        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create plan
        </button>
      </div>
    </Page>
  );
}
