import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { meterSchema } from "../../../api/schemas/meter.ts";
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

export const Route = createFileRoute("/meters")({
  component: MetersPage,
});

const emptyForm = () => ({
  unique_id: generateId("meter"),
  name: "",
  description: "",
  applicable_tax_types: "",
});

function MetersPage() {
  const queryClient = useQueryClient();
  const meters = useQuery({
    queryKey: ["meter"],
    queryFn: () => unwrap(api.v0.meter.$get()),
  });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const parsed = meterSchema.safeParse({
        unique_id: form.unique_id,
        created_at: Date.now(),
        deprecated_at: null,
        name: form.name,
        description: form.description === "" ? null : form.description,
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
      return unwrap(api.v0.meter.$post({ json: parsed.data }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data.unique_id}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["meter"] });
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
      unwrap(api.v0.meter[":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["meter"] }),
  });

  return (
    <Page
      title="Meters"
      sub="Usage dimensions tenants are charged against. Immutable; deleting deprecates."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
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
        empty="No meters yet."
        keyOf={(row) => row.unique_id}
        rows={meters.data ?? []}
      />

      <div className="panel">
        <h2>Create meter</h2>
        <Field label="Id">
          <IdInput
            prefix="meter"
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
          Create meter
        </button>
      </div>
    </Page>
  );
}
