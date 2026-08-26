import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field } from "./-components/fields.tsx";
import { KeyValueEditor } from "./-components/kv-editor.tsx";
import { IdInput } from "./-components/pickers.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, looksLikeId, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import { useTenants } from "../lib/queries.ts";

export const Route = createFileRoute("/tenants/")({
  component: TenantsPage,
});

const emptyForm = () => ({
  unique_id: generateId("tenant"),
  external_ids: {} as Record<string, string>,
});

function TenantsPage() {
  const queryClient = useQueryClient();
  const tenants = useTenants();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (
        !form.unique_id.startsWith("tenant_") ||
        !looksLikeId(form.unique_id)
      ) {
        throw new Error("id must look like tenant_<lowercase letters/digits>");
      }
      const body = {
        unique_id: form.unique_id,
        created_at: Date.now(),
        external_ids: form.external_ids,
      };
      return unwrap(api.v0.tenant.$post({ json: body }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data.unique_id}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["tenant"] });
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

  return (
    <Page
      title="Tenants"
      sub="Your customers. Everything tenant-scoped (assignments, invoices, payments, …) lives on the tenant."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          {
            header: "External ids",
            cell: (row) =>
              Object.entries(row.external_ids)
                .map(([system, id]) => `${system}: ${id}`)
                .join(", ") || "—",
          },
          {
            header: "Status",
            cell: (row) =>
              row.deleted_at ? (
                <span className="pill warn">deleted</span>
              ) : (
                <span className="pill ok">active</span>
              ),
          },
          {
            header: "Created",
            cell: (row) => fmtTimestamp(row.created_at),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No tenants yet."
        keyOf={(row) => row.unique_id}
        rowHref={(row) => `/tenants/${row.unique_id}`}
        rows={tenants.data ?? []}
      />

      <div className="panel">
        <h2>Create tenant</h2>
        <Field label="Id">
          <IdInput
            prefix="tenant"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <Field label="External ids">
          <KeyValueEditor
            value={form.external_ids}
            onChange={(external_ids) => setForm({ ...form, external_ids })}
          />
        </Field>
        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create tenant
        </button>
      </div>
    </Page>
  );
}
