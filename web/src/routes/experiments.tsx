import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { experimentSchema } from "../../../api/schemas/experiment.ts";
import {
  asJson,
  ErrorBox,
  fmtTimestamp,
  NoteBox,
  Page,
} from "./-components/feedback.tsx";
import { Field, NumberInput, TextInput } from "./-components/fields.tsx";
import { IdInput, IdSelect, MultiIdSelect } from "./-components/pickers.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import { useExperiments, usePlans, useTenants } from "../lib/queries.ts";

export const Route = createFileRoute("/experiments")({
  component: ExperimentsPage,
});

type TreatmentDraft = {
  plan: string;
  tenant_percentage: number | null;
  assigned_tenants: string[];
};

const emptyTreatment = (): TreatmentDraft => ({
  plan: "",
  tenant_percentage: null,
  assigned_tenants: [],
});

const emptyForm = () => ({
  unique_id: generateId("experiment"),
  name: "",
  description: "",
  treatments: [emptyTreatment(), emptyTreatment()] as TreatmentDraft[],
});

function ExperimentsPage() {
  const queryClient = useQueryClient();
  const experiments = useExperiments();
  const plans = usePlans();
  const tenants = useTenants();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [concluding, setConcluding] = useState<string | null>(null);
  const [concludePlan, setConcludePlan] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const parsed = experimentSchema.safeParse({
        unique_id: form.unique_id,
        created_at: Date.now(),
        concluded_at: null,
        plan_assignment_at_conclusion: null,
        name: form.name,
        description: form.description === "" ? null : form.description,
        treatments: form.treatments.map((treatment) => ({
          plan: treatment.plan,
          tenant_percentage: treatment.tenant_percentage ?? 0,
          assigned_tenants:
            treatment.assigned_tenants.length === 0
              ? null
              : treatment.assigned_tenants,
        })),
      });
      if (!parsed.success) {
        throw new Error(z.prettifyError(parsed.error));
      }
      return unwrap(api.v0.experiment.$post({ json: parsed.data }));
    },
    onSuccess: (data) => {
      setCreated(`Created ${data?.unique_id ?? "(see list)"}`);
      setError(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ["experiment"] });
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

  const conclude = useMutation({
    mutationFn: async (uniqueId: string) =>
      unwrap(
        api.v0.experiment[":id"].conclude.$post({
          param: { id: uniqueId },
          json: {
            concluded_at: Date.now(),
            plan_assignment_at_conclusion:
              concludePlan === "" ? null : concludePlan,
          },
        }),
      ),
    onSuccess: () => {
      setConcluding(null);
      void queryClient.invalidateQueries({ queryKey: ["experiment"] });
    },
    onError: (mutationError) => setError(String(mutationError)),
  });

  return (
    <Page
      title="Experiments"
      sub="Pricing experiments across plans. Concluded, never deleted."
    >
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Name", cell: (row) => row.name },
          { header: "Treatments", cell: (row) => row.treatments.length },
          {
            header: "Status",
            cell: (row) =>
              row.concluded_at ? (
                <span className="pill warn">
                  concluded {fmtTimestamp(row.concluded_at)}
                </span>
              ) : (
                <span className="pill ok">running</span>
              ),
          },
          {
            header: "Created",
            cell: (row) => fmtTimestamp(row.created_at),
          },
          {
            header: "",
            cell: (row) =>
              row.concluded_at ? null : concluding === row.unique_id ? (
                <span className="row" style={{ minWidth: 260 }}>
                  <IdSelect
                    placeholder="winning plan (optional)"
                    value={concludePlan}
                    onChange={setConcludePlan}
                    options={(plans.data ?? []).map((plan) => ({
                      id: plan.unique_id,
                      label: plan.name,
                    }))}
                  />
                  <button
                    className="small primary shrink"
                    onClick={(event) => {
                      event.stopPropagation();
                      conclude.mutate(row.unique_id);
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    className="small shrink"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConcluding(null);
                    }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConcluding(row.unique_id);
                    setConcludePlan("");
                  }}
                >
                  Conclude
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No experiments yet."
        keyOf={(row) => row.unique_id}
        rows={experiments.data ?? []}
      />

      <div className="panel">
        <h2>Create experiment</h2>
        <Field label="Id">
          <IdInput
            prefix="experiment"
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
          <label>Treatments (percentages must sum to 100; at least 2)</label>
          {form.treatments.map((treatment, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Treatment {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      treatments: form.treatments.filter((_, i) => i !== index),
                    })
                  }
                >
                  remove
                </button>
              </div>
              <div className="row">
                <Field label="Plan">
                  <IdSelect
                    placeholder="select a plan"
                    value={treatment.plan}
                    onChange={(plan) =>
                      setForm({
                        ...form,
                        treatments: form.treatments.map((t, i) =>
                          i === index ? { ...t, plan } : t,
                        ),
                      })
                    }
                    options={(plans.data ?? []).map((plan) => ({
                      id: plan.unique_id,
                      label: plan.name,
                    }))}
                  />
                </Field>
                <Field label="Tenant %">
                  <NumberInput
                    value={treatment.tenant_percentage}
                    onChange={(tenant_percentage) =>
                      setForm({
                        ...form,
                        treatments: form.treatments.map((t, i) =>
                          i === index ? { ...t, tenant_percentage } : t,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Assigned tenants (optional)">
                <MultiIdSelect
                  value={treatment.assigned_tenants}
                  onChange={(assigned_tenants) =>
                    setForm({
                      ...form,
                      treatments: form.treatments.map((t, i) =>
                        i === index ? { ...t, assigned_tenants } : t,
                      ),
                    })
                  }
                  options={(tenants.data ?? []).map((tenant) => ({
                    id: tenant.unique_id,
                    label: tenant.unique_id,
                  }))}
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
                treatments: [...form.treatments, emptyTreatment()],
              })
            }
          >
            Add treatment
          </button>
        </div>

        <ErrorBox error={error} />
        {created ? <NoteBox>{created}</NoteBox> : null}
        <button
          className="primary"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create experiment
        </button>
      </div>
    </Page>
  );
}
