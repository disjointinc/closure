import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { AddOnCreateBody } from "../../../api/v0/add-on/routes.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field, TextInput } from "./-components/fields.tsx";
import { FeatureSetToField } from "./-components/feature-set-to.tsx";
import { IdInput, IdSelect } from "./-components/pickers.tsx";
import {
  emptyCycleRef,
  resolveCycleRefDraft,
  CycleRefField,
  type CycleRefDraft,
} from "./-components/cycle-form.tsx";
import {
  emptyValueRef,
  resolveValueRefDraft,
  ValueRefField,
  type ValueRefDraft,
} from "./-components/subforms.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import { useAddOns, useFeatures } from "../lib/queries.ts";

export const Route = createFileRoute("/add-ons")({
  component: AddOnsPage,
});

type PriceDraft = { cycle: CycleRefDraft; value: ValueRefDraft };
type FeatureDraft = { feature: string; set_to: boolean | string[] };

const emptyForm = () => ({
  unique_id: generateId("add_on"),
  name: "",
  description: "",
  prices: [] as PriceDraft[],
  features: [] as FeatureDraft[],
});

function AddOnsPage() {
  const queryClient = useQueryClient();
  const addOns = useAddOns();
  const features = useFeatures();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: AddOnCreateBody = {
        unique_id: form.unique_id,
        created_at: Date.now(),
        deprecated_at: null,
        name: form.name,
        description: form.description === "" ? null : form.description,
        prices: form.prices.map((price) => ({
          cycle: resolveCycleRefDraft({ draft: price.cycle }),
          value: resolveValueRefDraft({ draft: price.value }),
        })),
        features: form.features.map((feature) => ({
          feature: feature.feature,
          set_to: feature.set_to,
        })),
      };
      return unwrap(api.v0["add-on"].$post({ json: body }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data?.unique_id ?? "(see list)"}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["add-on"] });
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
      unwrap(api.v0["add-on"][":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["add-on"] }),
  });

  const setPrice = (index: number, price: PriceDraft) =>
    setForm({
      ...form,
      prices: form.prices.map((p, i) => (i === index ? price : p)),
    });

  return (
    <Page
      title="Add-ons"
      sub="Sellable extras attachable to plans and assignments. Immutable; deleting deprecates."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          { header: "Prices", cell: (row) => row.prices.length },
          { header: "Features", cell: (row) => row.features.length },
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
        empty="No add-ons yet."
        keyOf={(row) => row.unique_id}
        rows={addOns.data ?? []}
      />

      <div className="panel">
        <h2>Create add-on</h2>
        <Field label="Id">
          <IdInput
            prefix="add_on"
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
                  onChange={(cycle) => setPrice(index, { ...price, cycle })}
                />
              </Field>
              <Field label="Value">
                <ValueRefField
                  value={price.value}
                  onChange={(value) => setPrice(index, { ...price, value })}
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
          <label>Features granted</label>
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

        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create add-on
        </button>
      </div>
    </Page>
  );
}
