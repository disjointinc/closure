import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { taxTypeSchema } from "../../../api/schemas/tax-type.ts";
import type { TaxCreateBody } from "../../../api/v0/tax/routes.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field, TextInput } from "./-components/fields.tsx";
import { IdInput, RefPicker, type RefValue } from "./-components/pickers.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";

export const Route = createFileRoute("/taxes")({
  component: TaxesPage,
});

const emptyForm = () => ({
  unique_id: generateId("tax"),
  name: "",
  description: "",
  tax_type: { kind: "existing", id: "" } as {
    kind: RefValue["kind"];
    id: string;
    inline: { unique_id: string; name: string; description: string };
  },
});

function TaxesPage() {
  const queryClient = useQueryClient();
  const taxes = useQuery({
    queryKey: ["tax"],
    queryFn: () => unwrap(api.v0.tax.$get()),
  });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      let taxType: string | z.infer<typeof taxTypeSchema>;
      if (form.tax_type.kind === "existing") {
        taxType = form.tax_type.id;
      } else {
        const inline = taxTypeSchema.safeParse({
          unique_id: form.tax_type.inline.unique_id,
          created_at: Date.now(),
          deprecated_at: null,
          name: form.tax_type.inline.name,
          description:
            form.tax_type.inline.description === ""
              ? null
              : form.tax_type.inline.description,
        });
        if (!inline.success) {
          throw new Error(`inline tax type: ${z.prettifyError(inline.error)}`);
        }
        taxType = inline.data;
      }
      // Validated client-side against the route's input type; the server
      // re-validates with the same zod schema.
      const body: TaxCreateBody = {
        unique_id: form.unique_id,
        created_at: Date.now(),
        deprecated_at: null,
        name: form.name,
        description: form.description === "" ? null : form.description,
        tax_type: taxType,
      };
      return unwrap(api.v0.tax.$post({ json: body }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data.unique_id}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["tax"] });
      void queryClient.invalidateQueries({ queryKey: ["tax-type"] });
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
      unwrap(api.v0.tax[":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tax"] }),
  });

  return (
    <Page
      title="Taxes"
      sub="Named taxes applied to invoices (amounts computed by your tax provider). Immutable; deleting deprecates."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          { header: "Tax type", cell: (row) => <IdCell id={row.tax_type} /> },
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
        empty="No taxes yet."
        keyOf={(row) => row.unique_id}
        rows={taxes.data ?? []}
      />

      <div className="panel">
        <h2>Create tax</h2>
        <Field label="Id">
          <IdInput
            prefix="tax"
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
        <Field label="Tax type">
          <RefPicker
            kind={form.tax_type.kind}
            idValue={form.tax_type.id}
            onKindChange={(kind) =>
              setForm({
                ...form,
                tax_type: {
                  kind,
                  id: form.tax_type.id,
                  inline: form.tax_type.inline ?? {
                    unique_id: generateId("tax_type"),
                    name: "",
                    description: "",
                  },
                },
              })
            }
            onIdChange={(id) =>
              setForm({ ...form, tax_type: { ...form.tax_type, id } })
            }
          />
          {form.tax_type.kind === "inline" ? (
            <div className="subform" style={{ marginTop: 8 }}>
              <div className="row">
                <Field label="Tax type id">
                  <IdInput
                    prefix="tax_type"
                    value={form.tax_type.inline.unique_id}
                    onChange={(unique_id) =>
                      setForm({
                        ...form,
                        tax_type: {
                          ...form.tax_type,
                          inline: { ...form.tax_type.inline, unique_id },
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Name">
                  <TextInput
                    value={form.tax_type.inline.name}
                    onChange={(name) =>
                      setForm({
                        ...form,
                        tax_type: {
                          ...form.tax_type,
                          inline: { ...form.tax_type.inline, name },
                        },
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          ) : null}
        </Field>
        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create tax
        </button>
      </div>
    </Page>
  );
}
