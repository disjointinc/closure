import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { CouponTemplateCreateBody } from "../../../api/v0/coupon-template/routes.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field } from "./-components/fields.tsx";
import { IdInput } from "./-components/pickers.tsx";
import {
  CouponDefForm,
  emptyCouponDef,
  resolveCouponDef,
} from "./-components/coupon-def-form.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import { useCouponTemplates } from "../lib/queries.ts";

export const Route = createFileRoute("/coupon-templates")({
  component: CouponTemplatesPage,
});

const emptyForm = () => ({
  unique_id: generateId("coupon_template"),
  definition: emptyCouponDef(),
});

function CouponTemplatesPage() {
  const queryClient = useQueryClient();
  const templates = useCouponTemplates();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const definition = resolveCouponDef({ draft: form.definition });
      const body: CouponTemplateCreateBody = {
        unique_id: form.unique_id,
        created_at: Date.now(),
        deprecated_at: null,
        grantable_by_tenants: definition.grantable_by_tenants,
        limit_per_granting_tenant: definition.limit_per_granting_tenant,
        name: definition.name,
        description: definition.description,
        default_award: definition.default_award,
        features_granted: definition.features_granted,
        credits_granted: definition.credits_granted,
        reciprocal_benefit_coupon_template: definition.reciprocal,
      };
      return unwrap(api.v0["coupon-template"].$post({ json: body }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data?.unique_id ?? "(see list)"}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["coupon-template"] });
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
      unwrap(
        api.v0["coupon-template"][":id"].$delete({ param: { id: uniqueId } }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["coupon-template"] }),
  });

  return (
    <Page
      title="Coupon templates"
      sub="Reusable coupon definitions (e.g. the referral coupon). Coupons mint from them; deleting deprecates."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          {
            header: "Default award",
            cell: (row) =>
              row.default_award
                ? row.default_award.type === "percentage_discount"
                  ? `${row.default_award.value}% off`
                  : row.default_award.type
                : "—",
          },
          {
            header: "Grantable",
            cell: (row) => (row.grantable_by_tenants ? "yes" : "no"),
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
        empty="No coupon templates yet."
        keyOf={(row) => row.unique_id}
        rows={templates.data ?? []}
      />

      <div className="panel">
        <h2>Create coupon template</h2>
        <Field label="Id">
          <IdInput
            prefix="coupon_template"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <CouponDefForm
          value={form.definition}
          onChange={(definition) => setForm({ ...form, definition })}
          reciprocalLabel="Reciprocal benefit template id (optional)"
        />
        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create coupon template
        </button>
      </div>
    </Page>
  );
}
