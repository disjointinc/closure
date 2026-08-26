import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { CouponCreateBody } from "../../../api/v0/coupon/routes.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field, TextInput } from "./-components/fields.tsx";
import { IdInput, IdSelect } from "./-components/pickers.tsx";
import {
  CouponDefForm,
  emptyCouponDef,
  resolveCouponDef,
} from "./-components/coupon-def-form.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import { useCoupons, useCouponTemplates } from "../lib/queries.ts";

export const Route = createFileRoute("/coupons")({
  component: CouponsPage,
});

const emptyForm = () => ({
  unique_id: generateId("coupon"),
  mode: "template" as "template" | "inline",
  template: "",
  reciprocal_benefit_coupon: "",
  definition: emptyCouponDef(),
});

function CouponsPage() {
  const queryClient = useQueryClient();
  const coupons = useCoupons();
  const templates = useCouponTemplates();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      let body: CouponCreateBody;
      if (form.mode === "template") {
        if (form.template === "") {
          throw new Error("select a template");
        }
        body = {
          unique_id: form.unique_id,
          created_at: Date.now(),
          deleted_at: null,
          template: form.template as CouponCreateBody extends infer T
            ? T extends { template: infer U }
              ? U
              : never
            : never,
          reciprocal_benefit_coupon:
            form.reciprocal_benefit_coupon === ""
              ? null
              : (form.reciprocal_benefit_coupon as never),
        };
      } else {
        const definition = resolveCouponDef({ draft: form.definition });
        body = {
          unique_id: form.unique_id,
          created_at: Date.now(),
          deleted_at: null,
          template: null,
          grantable_by_tenants: definition.grantable_by_tenants,
          limit_per_granting_tenant: definition.limit_per_granting_tenant,
          name: definition.name,
          description: definition.description,
          default_award: definition.default_award,
          features_granted: definition.features_granted,
          credits_granted: definition.credits_granted,
          reciprocal_benefit_coupon: definition.reciprocal,
        };
      }
      return unwrap(api.v0.coupon.$post({ json: body }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data.unique_id}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["coupon"] });
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

  const remove = useMutation({
    mutationFn: (uniqueId: string) =>
      unwrap(api.v0.coupon[":id"].$delete({ param: { id: uniqueId } })),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["coupon"] }),
  });

  return (
    <Page
      title="Coupons"
      sub="Individual consumable coupons, minted from a template or defined inline. Deleting marks deleted_at."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          {
            header: "Template",
            cell: (row) => (row.template ? <IdCell id={row.template} /> : "—"),
          },
          {
            header: "Grantable",
            cell: (row) => (row.grantable_by_tenants ? "yes" : "no"),
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
          {
            header: "",
            cell: (row) =>
              row.deleted_at ? null : (
                <button
                  className="danger small"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove.mutate(row.unique_id);
                  }}
                >
                  Delete
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No coupons yet."
        keyOf={(row) => row.unique_id}
        rows={coupons.data ?? []}
      />

      <div className="panel">
        <h2>Mint coupon</h2>
        <Field label="Id">
          <IdInput
            prefix="coupon"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <Field label="Source">
          <div className="row">
            <select
              className="shrink"
              value={form.mode}
              onChange={(event) =>
                setForm({
                  ...form,
                  mode: event.target.value as "template" | "inline",
                })
              }
            >
              <option value="template">From template</option>
              <option value="inline">Inline definition</option>
            </select>
          </div>
        </Field>
        {form.mode === "template" ? (
          <>
            <Field label="Template">
              <IdSelect
                placeholder="select a template"
                value={form.template}
                onChange={(template) => setForm({ ...form, template })}
                options={(templates.data ?? []).map((template) => ({
                  id: template.unique_id,
                  label: `${template.name} (${template.unique_id})`,
                }))}
              />
            </Field>
            <Field label="Reciprocal benefit coupon id (optional)">
              <TextInput
                mono
                value={form.reciprocal_benefit_coupon}
                onChange={(reciprocal_benefit_coupon) =>
                  setForm({ ...form, reciprocal_benefit_coupon })
                }
              />
            </Field>
          </>
        ) : (
          <CouponDefForm
            value={form.definition}
            onChange={(definition) => setForm({ ...form, definition })}
            reciprocalLabel="Reciprocal benefit coupon id (optional)"
          />
        )}
        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Mint coupon
        </button>
      </div>
    </Page>
  );
}
