import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { featureSchema } from "../../../api/schemas/feature.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field, TextInput } from "./-components/fields.tsx";
import { IdInput } from "./-components/pickers.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";

export const Route = createFileRoute("/features")({
  component: FeaturesPage,
});

type OptionDraft = { unique_id: string; name: string; description: string };

const emptyForm = () => ({
  unique_id: generateId("feature"),
  name: "",
  description: "",
  options: [] as OptionDraft[],
  applicable_tax_types: "",
});

function FeaturesPage() {
  const queryClient = useQueryClient();
  const features = useQuery({
    queryKey: ["feature"],
    queryFn: () => unwrap(api.v0.feature.$get()),
  });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const parsed = featureSchema.safeParse({
        unique_id: form.unique_id,
        created_at: Date.now(),
        deprecated_at: null,
        name: form.name,
        description: form.description === "" ? null : form.description,
        options:
          form.options.length === 0
            ? null
            : form.options.map((option) => ({
                unique_id: option.unique_id,
                name: option.name,
                description:
                  option.description === "" ? null : option.description,
              })),
        applicable_tax_types:
          form.applicable_tax_types.trim() === ""
            ? null
            : form.applicable_tax_types
                .split(",")
                .map((id) => id.trim())
                .filter((id) => id !== ""),
      });
      if (!parsed.success) {
        throw new Error(z.prettifyError(parsed.error));
      }
      return unwrap(api.v0.feature.$post({ json: parsed.data }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data.unique_id}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["feature"] });
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
      unwrap(api.v0.feature[":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["feature"] }),
  });

  return (
    <Page
      title="Features"
      sub="Boolean or enumerated capabilities granted by plans and add-ons. Immutable; deleting deprecates."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          {
            header: "Options",
            cell: (row) =>
              row.options ? row.options.map((o) => o.name).join(", ") : "—",
          },
          {
            header: "Tax types",
            cell: (row) => row.applicable_tax_types?.length ?? "—",
          },
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
        empty="No features yet."
        keyOf={(row) => row.unique_id}
        rows={features.data ?? []}
      />
      {features.isLoading ? <p className="muted">Loading…</p> : null}

      <div className="panel">
        <h2>Create feature</h2>
        <Field label="Id">
          <IdInput
            prefix="feature"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
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

        <div className="field">
          <label>Options (leave empty for a boolean feature)</label>
          {form.options.map((option, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Option {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      options: form.options.filter((_, i) => i !== index),
                    })
                  }
                >
                  remove
                </button>
              </div>
              <div className="row">
                <Field label="Id">
                  <IdInput
                    prefix="feature_option"
                    value={option.unique_id}
                    onChange={(unique_id) =>
                      setForm({
                        ...form,
                        options: form.options.map((o, i) =>
                          i === index ? { ...o, unique_id } : o,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Name">
                  <TextInput
                    value={option.name}
                    onChange={(name) =>
                      setForm({
                        ...form,
                        options: form.options.map((o, i) =>
                          i === index ? { ...o, name } : o,
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
                options: [
                  ...form.options,
                  {
                    unique_id: generateId("feature_option"),
                    name: "",
                    description: "",
                  },
                ],
              })
            }
          >
            Add option
          </button>
        </div>

        <Field
          label="Applicable tax types"
          hint="Comma-separated tax_type ids. Leave empty for none."
        >
          <TextInput
            mono
            value={form.applicable_tax_types}
            onChange={(applicable_tax_types) =>
              setForm({ ...form, applicable_tax_types })
            }
          />
        </Field>

        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create feature
        </button>
      </div>
    </Page>
  );
}
