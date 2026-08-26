import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  asJson,
  ErrorBox,
  fmtCredits,
  fmtTimestamp,
  messageOf,
  NoteBox,
  Page,
  Spinner,
} from "./-components/feedback.tsx";
import {
  DateTimeInput,
  Field,
  NumberInput,
  TextInput,
} from "./-components/fields.tsx";
import { FeatureSetToField } from "./-components/feature-set-to.tsx";
import { KeyValueEditor } from "./-components/kv-editor.tsx";
import {
  emptyMeterEntry,
  MeterEntryFields,
  resolveMeterEntry,
} from "./-components/meter-entry-form.tsx";
import { IdInput, IdSelect, MultiIdSelect } from "./-components/pickers.tsx";
import { DataTable, IdCell } from "./-components/table.tsx";
import { api, unwrap } from "../lib/api.ts";
import { generateId } from "../lib/ids.ts";
import {
  useAddOns,
  useCoupons,
  useCycles,
  useFeatures,
  useMeters,
  usePlans,
  useTeamMembers,
  useTenants,
  useValues,
} from "../lib/queries.ts";

export const Route = createFileRoute("/tenants/$tenantId")({
  component: TenantDetailPage,
});

function Section({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count?: number | string;
  title: string;
}) {
  return (
    <details className="section" open>
      <summary>
        <span>{title}</span>
        {count !== undefined ? <span className="count">{count}</span> : null}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function useSection() {
  const { tenantId } = Route.useParams();
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const onError = (e: unknown) => {
    setNote(null);
    setError(messageOf({ error: e }));
  };
  return { error, note, onError, refresh, setError, setNote, tenantId };
}

function Feedback({
  error,
  note,
}: {
  error: string | null;
  note: string | null;
}) {
  return (
    <>
      <ErrorBox error={error} />
      {note ? <NoteBox>{note}</NoteBox> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Entitlements (read-only, live view)
// ---------------------------------------------------------------------------

function EntitlementsSection() {
  const { tenantId } = Route.useParams();
  const entitlements = useQuery({
    queryKey: ["tenant", tenantId, "entitlements"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"].entitlements.$get({ param: { id: tenantId } }),
      ),
  });
  if (entitlements.isLoading) {
    return <Spinner />;
  }
  const data = entitlements.data;
  if (!data) {
    return <p className="muted">No entitlements (no open assignment).</p>;
  }
  return (
    <>
      <p className="muted">
        Assignment: <code className="mono">{data.assignment ?? "none"}</code>
      </p>
      <h2>Features</h2>
      <DataTable
        columns={[
          { header: "Feature", cell: (row) => <IdCell id={row.feature} /> },
          {
            header: "Set to",
            cell: (row) =>
              Array.isArray(row.set_to)
                ? row.set_to.join(", ")
                : String(row.set_to),
          },
        ]}
        empty="No features."
        keyOf={(row) => row.feature}
        rows={data.features}
      />
      <h2>Meters (live balances)</h2>
      <DataTable
        columns={[
          { header: "Meter", cell: (row) => <IdCell id={row.meter} /> },
          {
            header: "Default",
            cell: (row) => fmtCredits(row.default_microcredits),
          },
          {
            header: "Limit",
            cell: (row) =>
              row.limit_microcredits === null
                ? "unlimited"
                : fmtCredits(row.limit_microcredits),
          },
          {
            header: "Balance",
            cell: (row) => (
              <strong>{fmtCredits(row.balance_microcredits)}</strong>
            ),
          },
        ]}
        empty="No meters."
        keyOf={(row) => row.meter}
        rows={data.meters}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

function AssignmentsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const assignments = useQuery({
    queryKey: ["tenant", tenantId, "assignment"],
    queryFn: () =>
      unwrap(api.v0.tenant[":id"].assignment.$get({ param: { id: tenantId } })),
  });
  const plans = usePlans();
  const cycles = useCycles();
  const addOns = useAddOns();
  const [form, setForm] = useState(() => ({
    unique_id: generateId("assignment"),
    plan: "",
    experiment: "",
    cycle: "",
    start: Date.now() as number | null,
    end: null as number | null,
    add_ons: [] as { add_on: string; start: number; end: number | null }[],
  }));

  const create = useMutation({
    mutationFn: async () => {
      if (form.plan === "" || form.cycle === "" || form.start === null) {
        throw new Error("plan, cycle, and start are required");
      }
      return unwrap(
        api.v0.tenant[":id"].assignment.$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            plan: form.plan,
            experiment: form.experiment === "" ? null : form.experiment,
            cycle: form.cycle,
            start: form.start,
            end: form.end,
            add_ons: form.add_ons,
          },
        }),
      );
    },
    onSuccess: (data) => {
      s.setNote(`Created ${data?.unique_id ?? "assignment"}`);
      s.setError(null);
      setForm({ ...form, unique_id: generateId("assignment") });
      s.refresh();
    },
    onError: s.onError,
  });

  const attach = useMutation({
    mutationFn: async (input: { assignmentId: string; addOn: string }) =>
      unwrap(
        api.v0.tenant[":id"].assignment[":assignment_id"]["add-ons"].$post({
          param: { id: tenantId, assignment_id: input.assignmentId },
          json: { add_on: input.addOn, start: Date.now(), end: null },
        }),
      ),
    onSuccess: () => s.refresh(),
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Plan", cell: (row) => <IdCell id={row.plan} /> },
          { header: "Cycle", cell: (row) => <IdCell id={row.cycle} /> },
          { header: "Start", cell: (row) => fmtTimestamp(row.start) },
          { header: "End", cell: (row) => fmtTimestamp(row.end) },
          {
            header: "Add-ons",
            cell: (row) => row.add_ons.map((a) => a.add_on).join(", ") || "—",
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No assignments yet."
        keyOf={(row) => row.unique_id}
        rows={assignments.data ?? []}
      />
      <div className="panel">
        <h2>New assignment (ends the open one; initializes meter balances)</h2>
        <Field label="Id">
          <IdInput
            prefix="assignment"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="Plan">
            <IdSelect
              placeholder="select a plan"
              value={form.plan}
              onChange={(plan) => setForm({ ...form, plan })}
              options={(plans.data ?? []).map((plan) => ({
                id: plan.unique_id,
                label: plan.name,
              }))}
            />
          </Field>
          <Field label="Cycle">
            <IdSelect
              placeholder="select a cycle"
              value={form.cycle}
              onChange={(cycle) => setForm({ ...form, cycle })}
              options={(cycles.data ?? []).map((cycle) => ({
                id: cycle.unique_id,
                label: cycle.name,
              }))}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Start">
            <DateTimeInput
              value={form.start}
              onChange={(start) => setForm({ ...form, start })}
            />
          </Field>
          <Field label="End (optional)">
            <DateTimeInput
              value={form.end}
              onChange={(end) => setForm({ ...form, end })}
            />
          </Field>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => create.mutate()}>
          Assign plan
        </button>
      </div>
      {(assignments.data ?? []).length > 0 ? (
        <div className="panel">
          <h2>Attach add-on to the open assignment</h2>
          <AttachAddOnForm
            assignmentId={
              (assignments.data ?? []).find((a) => a.end === null)?.unique_id ??
              null
            }
            addOnOptions={(addOns.data ?? []).map((addOn) => ({
              id: addOn.unique_id,
              label: addOn.name,
            }))}
            onAttach={(addOn, assignmentId) =>
              attach.mutate({ addOn, assignmentId })
            }
          />
          <Feedback error={s.error} note={null} />
        </div>
      ) : null}
    </>
  );
}

function AttachAddOnForm({
  addOnOptions,
  assignmentId,
  onAttach,
}: {
  addOnOptions: { id: string; label: string }[];
  assignmentId: string | null;
  onAttach: (addOn: string, assignmentId: string) => void;
}) {
  const [addOn, setAddOn] = useState("");
  if (!assignmentId) {
    return <p className="muted">No open assignment to attach to.</p>;
  }
  return (
    <div className="row">
      <IdSelect
        placeholder="select an add-on"
        value={addOn}
        onChange={setAddOn}
        options={addOnOptions}
      />
      <button
        className="shrink"
        disabled={addOn === ""}
        onClick={() => onAttach(addOn, assignmentId)}
      >
        Attach
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter events
// ---------------------------------------------------------------------------

function MeterEventsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const events = useQuery({
    queryKey: ["tenant", tenantId, "meter-event"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["meter-event"].$get({ param: { id: tenantId } }),
      ),
  });
  const meters = useMeters();
  const [form, setForm] = useState(() => ({
    unique_id: generateId("meter_event"),
    unique_external_id: "",
    meter: "",
    amount: null as number | null,
  }));

  const record = useMutation({
    mutationFn: async () => {
      if (form.meter === "" || form.amount === null || form.amount === 0) {
        throw new Error("meter and a nonzero amount are required");
      }
      return unwrap(
        api.v0.tenant[":id"]["meter-event"].$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            ...(form.unique_external_id === ""
              ? {}
              : { unique_external_id: form.unique_external_id }),
            created_at: Date.now(),
            meter: form.meter,
            amount: form.amount,
          },
        }),
      );
    },
    onSuccess: (data) => {
      s.setNote(
        `Recorded (${data.status}); balance now ${fmtCredits(data.balance_microcredits)}`,
      );
      s.setError(null);
      setForm({ ...form, unique_id: generateId("meter_event"), amount: null });
      s.refresh();
      void s.refresh();
    },
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "Created", cell: (row) => fmtTimestamp(row.created_at) },
          { header: "Meter", cell: (row) => <IdCell id={row.meter} /> },
          { header: "Amount", cell: (row) => fmtCredits(row.amount) },
          {
            header: "Status",
            cell: (row) => (
              <span
                className={`pill ${row.status === "succeeded" ? "ok" : "warn"}`}
              >
                {row.status}
              </span>
            ),
          },
          {
            header: "External id",
            cell: (row) => row.unique_external_id ?? "—",
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No meter events yet."
        keyOf={(row) => row.unique_id}
        rows={events.data ?? []}
      />
      <div className="panel">
        <h2>Record meter event</h2>
        <Field label="Id">
          <IdInput
            prefix="meter_event"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <Field
          label="Idempotency key (optional)"
          hint="Repeat deliveries with the same key return the original outcome without double-charging."
        >
          <TextInput
            mono
            value={form.unique_external_id}
            onChange={(unique_external_id) =>
              setForm({ ...form, unique_external_id })
            }
          />
        </Field>
        <div className="row">
          <Field label="Meter">
            <IdSelect
              placeholder="select a meter"
              value={form.meter}
              onChange={(meter) => setForm({ ...form, meter })}
              options={(meters.data ?? []).map((meter) => ({
                id: meter.unique_id,
                label: meter.name,
              }))}
            />
          </Field>
          <Field label="Amount (microcredits; negative refunds)">
            <NumberInput
              signed
              value={form.amount}
              onChange={(amount) => setForm({ ...form, amount })}
            />
          </Field>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => record.mutate()}>
          Record event
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Credit grants
// ---------------------------------------------------------------------------

function CreditGrantsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const grants = useQuery({
    queryKey: ["tenant", tenantId, "credit-grant"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["credit-grant"].$get({ param: { id: tenantId } }),
      ),
  });
  const meters = useMeters();
  const teamMembers = useTeamMembers();
  const [form, setForm] = useState(() => ({
    unique_id: generateId("credit_grant"),
    meter: "",
    by: "",
    reason: "",
    amount: null as number | null,
  }));

  const create = useMutation({
    mutationFn: async () => {
      if (form.meter === "" || form.by === "" || form.amount === null) {
        throw new Error("meter, by, and amount are required");
      }
      return unwrap(
        api.v0.tenant[":id"]["credit-grant"].$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            meter: form.meter,
            on: Date.now(),
            by: form.by,
            reason: form.reason === "" ? null : form.reason,
            amount: form.amount,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Grant applied to the balance.");
      s.setError(null);
      setForm({ ...form, unique_id: generateId("credit_grant"), amount: null });
      s.refresh();
    },
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "On", cell: (row) => fmtTimestamp(row.on) },
          { header: "Meter", cell: (row) => <IdCell id={row.meter} /> },
          { header: "Amount", cell: (row) => fmtCredits(row.amount) },
          { header: "By", cell: (row) => <IdCell id={row.by} /> },
          { header: "Reason", cell: (row) => row.reason ?? "—" },
        ]}
        expandable={(row) => asJson(row)}
        empty="No credit grants yet."
        keyOf={(row) => row.unique_id}
        rows={grants.data ?? []}
      />
      <div className="panel">
        <h2>Grant credits</h2>
        <Field label="Id">
          <IdInput
            prefix="credit_grant"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="Meter">
            <IdSelect
              placeholder="select a meter"
              value={form.meter}
              onChange={(meter) => setForm({ ...form, meter })}
              options={(meters.data ?? []).map((meter) => ({
                id: meter.unique_id,
                label: meter.name,
              }))}
            />
          </Field>
          <Field label="Amount (microcredits)">
            <NumberInput
              value={form.amount}
              onChange={(amount) => setForm({ ...form, amount })}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="By (team member)">
            <IdSelect
              placeholder="select a team member"
              value={form.by}
              onChange={(by) => setForm({ ...form, by })}
              options={(teamMembers.data ?? []).map((member) => ({
                id: member.unique_id,
                label: member.name ?? member.email_address,
              }))}
            />
          </Field>
          <Field label="Reason (optional)">
            <TextInput
              value={form.reason}
              onChange={(reason) => setForm({ ...form, reason })}
            />
          </Field>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => create.mutate()}>
          Grant credits
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

function OverridesSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const featureOverrides = useQuery({
    queryKey: ["tenant", tenantId, "feature-override"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["feature-override"].$get({
          param: { id: tenantId },
        }),
      ),
  });
  const meterOverrides = useQuery({
    queryKey: ["tenant", tenantId, "meter-override"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["meter-override"].$get({
          param: { id: tenantId },
        }),
      ),
  });
  const features = useFeatures();
  const teamMembers = useTeamMembers();
  const [featureForm, setFeatureForm] = useState(() => ({
    unique_id: generateId("feature_override"),
    feature: "",
    set_to: true as boolean | string[],
    by: "",
    reason: "",
  }));
  const [meterForm, setMeterForm] = useState(() => ({
    unique_id: generateId("meter_override"),
    by: "",
    reason: "",
    entry: emptyMeterEntry(),
  }));

  const createFeatureOverride = useMutation({
    mutationFn: async () => {
      if (featureForm.feature === "" || featureForm.by === "") {
        throw new Error("feature and by are required");
      }
      return unwrap(
        api.v0.tenant[":id"]["feature-override"].$post({
          param: { id: tenantId },
          json: {
            unique_id: featureForm.unique_id,
            feature: featureForm.feature,
            set_to: featureForm.set_to,
            on: Date.now(),
            by: featureForm.by,
            reason: featureForm.reason === "" ? null : featureForm.reason,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Feature override applied.");
      s.setError(null);
      setFeatureForm({
        ...featureForm,
        unique_id: generateId("feature_override"),
      });
      s.refresh();
    },
    onError: s.onError,
  });

  const createMeterOverride = useMutation({
    mutationFn: async () => {
      if (meterForm.by === "") {
        throw new Error("by is required");
      }
      const entry = resolveMeterEntry({ draft: meterForm.entry });
      return unwrap(
        api.v0.tenant[":id"]["meter-override"].$post({
          param: { id: tenantId },
          json: {
            ...entry,
            unique_id: meterForm.unique_id,
            on: Date.now(),
            by: meterForm.by,
            reason: meterForm.reason === "" ? null : meterForm.reason,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Meter override applied.");
      s.setError(null);
      setMeterForm({ ...meterForm, unique_id: generateId("meter_override") });
      s.refresh();
    },
    onError: s.onError,
  });

  const memberOptions = (teamMembers.data ?? []).map((member) => ({
    id: member.unique_id,
    label: member.name ?? member.email_address,
  }));

  return (
    <>
      <h2>Feature overrides</h2>
      <DataTable
        columns={[
          { header: "Feature", cell: (row) => <IdCell id={row.feature} /> },
          {
            header: "Set to",
            cell: (row) =>
              Array.isArray(row.set_to)
                ? row.set_to.join(", ")
                : String(row.set_to),
          },
          { header: "By", cell: (row) => <IdCell id={row.by} /> },
          { header: "On", cell: (row) => fmtTimestamp(row.on) },
        ]}
        expandable={(row) => asJson(row)}
        empty="No feature overrides."
        keyOf={(row) => row.unique_id}
        rows={featureOverrides.data ?? []}
      />
      <div className="panel">
        <h2>Override a feature</h2>
        <Field label="Id">
          <IdInput
            prefix="feature_override"
            value={featureForm.unique_id}
            onChange={(unique_id) =>
              setFeatureForm({ ...featureForm, unique_id })
            }
          />
        </Field>
        <div className="row">
          <Field label="Feature">
            <IdSelect
              placeholder="select a feature"
              value={featureForm.feature}
              onChange={(feature) =>
                setFeatureForm({ ...featureForm, feature, set_to: true })
              }
              options={(features.data ?? []).map((feature) => ({
                id: feature.unique_id,
                label: feature.name,
              }))}
            />
          </Field>
          <Field label="Set to">
            <FeatureSetToField
              featureId={featureForm.feature}
              value={featureForm.set_to}
              onChange={(set_to) => setFeatureForm({ ...featureForm, set_to })}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="By (team member)">
            <IdSelect
              placeholder="select a team member"
              value={featureForm.by}
              onChange={(by) => setFeatureForm({ ...featureForm, by })}
              options={memberOptions}
            />
          </Field>
          <Field label="Reason (optional)">
            <TextInput
              value={featureForm.reason}
              onChange={(reason) => setFeatureForm({ ...featureForm, reason })}
            />
          </Field>
        </div>
        <button
          className="primary"
          onClick={() => createFeatureOverride.mutate()}
        >
          Apply feature override
        </button>
      </div>

      <h2>Meter overrides</h2>
      <DataTable
        columns={[
          { header: "Meter", cell: (row) => <IdCell id={row.meter} /> },
          { header: "Default", cell: (row) => fmtCredits(row.default) },
          {
            header: "Limit",
            cell: (row) =>
              row.limit === null ? "unlimited" : fmtCredits(row.limit),
          },
          { header: "By", cell: (row) => <IdCell id={row.by} /> },
          { header: "On", cell: (row) => fmtTimestamp(row.on) },
        ]}
        expandable={(row) => asJson(row)}
        empty="No meter overrides."
        keyOf={(row) => row.unique_id}
        rows={meterOverrides.data ?? []}
      />
      <div className="panel">
        <h2>Override a meter</h2>
        <Field label="Id">
          <IdInput
            prefix="meter_override"
            value={meterForm.unique_id}
            onChange={(unique_id) => setMeterForm({ ...meterForm, unique_id })}
          />
        </Field>
        <MeterEntryFields
          value={meterForm.entry}
          onChange={(entry) => setMeterForm({ ...meterForm, entry })}
        />
        <div className="row">
          <Field label="By (team member)">
            <IdSelect
              placeholder="select a team member"
              value={meterForm.by}
              onChange={(by) => setMeterForm({ ...meterForm, by })}
              options={memberOptions}
            />
          </Field>
          <Field label="Reason (optional)">
            <TextInput
              value={meterForm.reason}
              onChange={(reason) => setMeterForm({ ...meterForm, reason })}
            />
          </Field>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button
          className="primary"
          onClick={() => createMeterOverride.mutate()}
        >
          Apply meter override
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

function InvoicesSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const invoices = useQuery({
    queryKey: ["tenant", tenantId, "invoice"],
    queryFn: () =>
      unwrap(api.v0.tenant[":id"].invoice.$get({ param: { id: tenantId } })),
  });
  const values = useValues();
  const taxes = useQuery({
    queryKey: ["tax"],
    queryFn: () => unwrap(api.v0.tax.$get()),
  });
  const [form, setForm] = useState(() => ({
    unique_id: generateId("invoice"),
    charged: "upfront" as "upfront" | "arrears",
    credit_period_days: 7 as number | null,
    grace_enabled: false,
    grace_period_days: 3 as number | null,
    dunning_schedule: "[]",
    items: [] as {
      unique_id: string;
      per_unit_value: string;
      units: number | null;
      name: string;
      description: string;
    }[],
    taxation_amounts: [] as {
      unique_id: string;
      tax: string;
      applies_to_items: string;
      notes: string;
      currency: string;
      unit: string;
      amount: number | null;
    }[],
  }));

  const create = useMutation({
    mutationFn: async () => {
      if (form.items.length === 0) {
        throw new Error("at least one item is required");
      }
      const charging =
        form.charged === "upfront"
          ? ({ charged: "upfront", cycle_length: "one-time" } as const)
          : ({
              charged: "arrears",
              cycle_length: { days: null, months: 1 },
              credit_period: {
                days: form.credit_period_days ?? 7,
                months: null,
              },
              grace_period: form.grace_enabled
                ? { days: form.grace_period_days ?? 3, months: null }
                : null,
              dunning_schedule: JSON.parse(form.dunning_schedule || "[]"),
            } as const);
      return unwrap(
        api.v0.tenant[":id"].invoice.$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            created_at: Date.now(),
            closed_at: null,
            closed_reason: null,
            ...charging,
            items: form.items.map((item) => {
              if (item.per_unit_value === "" || item.units === null) {
                throw new Error("items need a value and units");
              }
              return {
                unique_id: item.unique_id,
                per_unit_value: item.per_unit_value,
                units: item.units,
                name: item.name,
                description: item.description === "" ? null : item.description,
              };
            }),
            taxation_amounts: form.taxation_amounts.map((tax) => ({
              unique_id: tax.unique_id,
              tax: tax.tax,
              applies_to_items:
                tax.applies_to_items.trim() === ""
                  ? null
                  : tax.applies_to_items
                      .split(",")
                      .map((id) => id.trim())
                      .filter((id) => id !== ""),
              notes: tax.notes === "" ? null : tax.notes,
              amount: {
                currency: tax.currency,
                unit: tax.unit,
                value: tax.amount ?? 0,
              },
            })),
          } as never,
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Invoice created.");
      s.setError(null);
      setForm({
        ...form,
        unique_id: generateId("invoice"),
        items: [],
        taxation_amounts: [],
      });
      s.refresh();
    },
    onError: s.onError,
  });

  const close = useMutation({
    mutationFn: async (invoiceId: string) =>
      unwrap(
        api.v0.tenant[":id"].invoice[":invoice_id"].close.$post({
          param: { id: tenantId, invoice_id: invoiceId },
          json: { closed_at: Date.now(), closed_reason: null },
        }),
      ),
    onSuccess: () => s.refresh(),
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Charged", cell: (row) => row.charged },
          { header: "Items", cell: (row) => row.items.length },
          {
            header: "Status",
            cell: (row) =>
              row.closed_at ? (
                <span className="pill warn">closed</span>
              ) : (
                <span className="pill ok">open</span>
              ),
          },
          {
            header: "Created",
            cell: (row) => fmtTimestamp(row.created_at),
          },
          {
            header: "",
            cell: (row) =>
              row.closed_at ? null : (
                <button
                  className="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    close.mutate(row.unique_id);
                  }}
                >
                  Close
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No invoices yet."
        keyOf={(row) => row.unique_id}
        rows={invoices.data ?? []}
      />
      <div className="panel">
        <h2>Create invoice</h2>
        <Field label="Id">
          <IdInput
            prefix="invoice"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <Field label="Charged">
          <select
            value={form.charged}
            onChange={(event) =>
              setForm({
                ...form,
                charged: event.target.value as "upfront" | "arrears",
              })
            }
          >
            <option value="upfront">upfront (one-time)</option>
            <option value="arrears">arrears (monthly)</option>
          </select>
        </Field>

        <div className="field">
          <label>Items</label>
          {form.items.map((item, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Item {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      items: form.items.filter((_, i) => i !== index),
                    })
                  }
                >
                  remove
                </button>
              </div>
              <div className="row">
                <Field label="Id">
                  <IdInput
                    prefix="item"
                    value={item.unique_id}
                    onChange={(unique_id) =>
                      setForm({
                        ...form,
                        items: form.items.map((it, i) =>
                          i === index ? { ...it, unique_id } : it,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Per-unit value">
                  <IdSelect
                    placeholder="select a value"
                    value={item.per_unit_value}
                    onChange={(per_unit_value) =>
                      setForm({
                        ...form,
                        items: form.items.map((it, i) =>
                          i === index ? { ...it, per_unit_value } : it,
                        ),
                      })
                    }
                    options={(values.data ?? []).map((value) => ({
                      id: value.unique_id,
                      label: `${value.name} (${value.amounts.map((a) => `${a.value} ${a.unit}`).join(", ")})`,
                    }))}
                  />
                </Field>
              </div>
              <div className="row">
                <Field label="Units">
                  <NumberInput
                    value={item.units}
                    onChange={(units) =>
                      setForm({
                        ...form,
                        items: form.items.map((it, i) =>
                          i === index ? { ...it, units } : it,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Name">
                  <TextInput
                    value={item.name}
                    onChange={(name) =>
                      setForm({
                        ...form,
                        items: form.items.map((it, i) =>
                          i === index ? { ...it, name } : it,
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
                items: [
                  ...form.items,
                  {
                    unique_id: generateId("item"),
                    per_unit_value: "",
                    units: 1,
                    name: "",
                    description: "",
                  },
                ],
              })
            }
          >
            Add item
          </button>
        </div>

        <div className="field">
          <label>Taxation amounts (computed by your tax provider)</label>
          {form.taxation_amounts.map((tax, index) => (
            <div className="subform" key={index}>
              <div className="subform-head">
                <span>Tax {index + 1}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    setForm({
                      ...form,
                      taxation_amounts: form.taxation_amounts.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  remove
                </button>
              </div>
              <div className="row">
                <Field label="Id">
                  <IdInput
                    prefix="taxation_amount"
                    value={tax.unique_id}
                    onChange={(unique_id) =>
                      setForm({
                        ...form,
                        taxation_amounts: form.taxation_amounts.map((t, i) =>
                          i === index ? { ...t, unique_id } : t,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Tax">
                  <IdSelect
                    placeholder="select a tax"
                    value={tax.tax}
                    onChange={(t) =>
                      setForm({
                        ...form,
                        taxation_amounts: form.taxation_amounts.map((x, i) =>
                          i === index ? { ...x, tax: t } : x,
                        ),
                      })
                    }
                    options={(taxes.data ?? []).map((t) => ({
                      id: t.unique_id,
                      label: t.name,
                    }))}
                  />
                </Field>
              </div>
              <div className="row">
                <Field label="Currency">
                  <TextInput
                    value={tax.currency}
                    onChange={(currency) =>
                      setForm({
                        ...form,
                        taxation_amounts: form.taxation_amounts.map((t, i) =>
                          i === index ? { ...t, currency } : t,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Unit">
                  <TextInput
                    value={tax.unit}
                    onChange={(unit) =>
                      setForm({
                        ...form,
                        taxation_amounts: form.taxation_amounts.map((t, i) =>
                          i === index ? { ...t, unit } : t,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Amount">
                  <NumberInput
                    value={tax.amount}
                    onChange={(amount) =>
                      setForm({
                        ...form,
                        taxation_amounts: form.taxation_amounts.map((t, i) =>
                          i === index ? { ...t, amount } : t,
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
                taxation_amounts: [
                  ...form.taxation_amounts,
                  {
                    unique_id: generateId("taxation_amount"),
                    tax: "",
                    applies_to_items: "",
                    notes: "",
                    currency: "USD",
                    unit: "cents",
                    amount: null,
                  },
                ],
              })
            }
          >
            Add taxation amount
          </button>
        </div>

        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => create.mutate()}>
          Create invoice
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const payments = useQuery({
    queryKey: ["tenant", tenantId, "payment"],
    queryFn: () =>
      unwrap(api.v0.tenant[":id"].payment.$get({ param: { id: tenantId } })),
  });
  const invoices = useQuery({
    queryKey: ["tenant", tenantId, "invoice"],
    queryFn: () =>
      unwrap(api.v0.tenant[":id"].invoice.$get({ param: { id: tenantId } })),
  });
  const [form, setForm] = useState(() => ({
    unique_id: generateId("payment"),
    provider_id: "stripe",
    provider_payment_id: "",
    provider_customer_id: "",
    invoices: [] as string[],
  }));
  const [lifecycle, setLifecycle] = useState<{
    id: string;
    field: "started_processing_at" | "succeeded_at" | "failed_at";
  } | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (form.provider_payment_id === "" || form.provider_customer_id === "") {
        throw new Error("provider payment id and customer id are required");
      }
      return unwrap(
        api.v0.tenant[":id"].payment.$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            created_at: Date.now(),
            started_processing_at: null,
            succeeded_at: null,
            failed_at: null,
            provider_internals: {
              id: form.provider_id,
              payment_id: form.provider_payment_id,
              customer_id: form.provider_customer_id,
            },
            invoices: form.invoices,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Payment recorded.");
      s.setError(null);
      setForm({
        ...form,
        unique_id: generateId("payment"),
        provider_payment_id: "",
      });
      s.refresh();
    },
    onError: s.onError,
  });

  const patch = useMutation({
    mutationFn: async (paymentId: string) => {
      if (!lifecycle) {
        throw new Error("pick a lifecycle field");
      }
      return unwrap(
        api.v0.tenant[":id"].payment[":payment_id"].$patch({
          param: { id: tenantId, payment_id: paymentId },
          json: { [lifecycle.field]: Date.now() },
        }),
      );
    },
    onSuccess: () => {
      setLifecycle(null);
      s.refresh();
    },
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Invoices", cell: (row) => row.invoices.length },
          {
            header: "Status",
            cell: (row) =>
              row.succeeded_at ? (
                <span className="pill ok">succeeded</span>
              ) : row.failed_at ? (
                <span className="pill warn">failed</span>
              ) : row.started_processing_at ? (
                <span className="pill">processing</span>
              ) : (
                <span className="pill">created</span>
              ),
          },
          {
            header: "Provider",
            cell: (row) => row.provider_internals.id,
          },
          {
            header: "Created",
            cell: (row) => fmtTimestamp(row.created_at),
          },
          {
            header: "",
            cell: (row) =>
              lifecycle?.id === row.unique_id ? (
                <span className="row" style={{ minWidth: 220 }}>
                  <select
                    className="shrink"
                    value={lifecycle.field}
                    onChange={(event) =>
                      setLifecycle({
                        id: row.unique_id,
                        field: event.target.value as typeof lifecycle.field,
                      })
                    }
                  >
                    <option value="started_processing_at">processing</option>
                    <option value="succeeded_at">succeeded</option>
                    <option value="failed_at">failed</option>
                  </select>
                  <button
                    className="small primary shrink"
                    onClick={(event) => {
                      event.stopPropagation();
                      patch.mutate(row.unique_id);
                    }}
                  >
                    Now
                  </button>
                  <button
                    className="small shrink"
                    onClick={(event) => {
                      event.stopPropagation();
                      setLifecycle(null);
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
                    setLifecycle({
                      id: row.unique_id,
                      field: "succeeded_at",
                    });
                  }}
                >
                  Update lifecycle
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No payments yet."
        keyOf={(row) => row.unique_id}
        rows={payments.data ?? []}
      />
      <div className="panel">
        <h2>Record payment</h2>
        <Field label="Id">
          <IdInput
            prefix="payment"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="Provider">
            <TextInput
              value={form.provider_id}
              onChange={(provider_id) => setForm({ ...form, provider_id })}
            />
          </Field>
          <Field label="Provider payment id">
            <TextInput
              mono
              value={form.provider_payment_id}
              onChange={(provider_payment_id) =>
                setForm({ ...form, provider_payment_id })
              }
            />
          </Field>
          <Field label="Provider customer id">
            <TextInput
              mono
              value={form.provider_customer_id}
              onChange={(provider_customer_id) =>
                setForm({ ...form, provider_customer_id })
              }
            />
          </Field>
        </div>
        <Field label="Invoices">
          <MultiIdSelect
            value={form.invoices}
            onChange={(invoices) => setForm({ ...form, invoices })}
            options={(invoices.data ?? []).map((invoice) => ({
              id: invoice.unique_id,
              label: `${invoice.unique_id} (${invoice.items.length} items)`,
            }))}
          />
        </Field>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => create.mutate()}>
          Record payment
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

function PaymentMethodsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const methods = useQuery({
    queryKey: ["tenant", tenantId, "payment-method"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["payment-method"].$get({
          param: { id: tenantId },
        }),
      ),
  });
  const [form, setForm] = useState(() => ({
    unique_id: generateId("payment_method"),
    provider_id: "stripe",
    method_id: "",
    is_default: false,
  }));

  const create = useMutation({
    mutationFn: async () => {
      if (form.method_id === "") {
        throw new Error("provider method id is required");
      }
      return unwrap(
        api.v0.tenant[":id"]["payment-method"].$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            created_at: Date.now(),
            deleted_at: null,
            is_default: form.is_default,
            provider_internals: {
              id: form.provider_id,
              method_id: form.method_id,
            },
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Payment method added.");
      s.setError(null);
      setForm({
        ...form,
        unique_id: generateId("payment_method"),
        method_id: "",
      });
      s.refresh();
    },
    onError: s.onError,
  });

  const setDefault = useMutation({
    mutationFn: (methodId: string) =>
      unwrap(
        api.v0.tenant[":id"]["payment-method"][
          ":payment_method_id"
        ].default.$post({
          param: { id: tenantId, payment_method_id: methodId },
        }),
      ),
    onSuccess: () => s.refresh(),
    onError: s.onError,
  });

  const remove = useMutation({
    mutationFn: (methodId: string) =>
      unwrap(
        api.v0.tenant[":id"]["payment-method"][":payment_method_id"].$delete({
          param: { id: tenantId, payment_method_id: methodId },
        }),
      ),
    onSuccess: () => s.refresh(),
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          {
            header: "Default",
            cell: (row) =>
              row.is_default ? <span className="pill ok">default</span> : "—",
          },
          {
            header: "Provider",
            cell: (row) =>
              `${row.provider_internals.id} · ${row.provider_internals.method_id}`,
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
            header: "",
            cell: (row) =>
              row.deleted_at ? null : (
                <span>
                  {row.is_default ? null : (
                    <button
                      className="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDefault.mutate(row.unique_id);
                      }}
                    >
                      Set default
                    </button>
                  )}{" "}
                  <button
                    className="danger small"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove.mutate(row.unique_id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No payment methods yet."
        keyOf={(row) => row.unique_id}
        rows={methods.data ?? []}
      />
      <div className="panel">
        <h2>Add payment method</h2>
        <Field label="Id">
          <IdInput
            prefix="payment_method"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="Provider">
            <TextInput
              value={form.provider_id}
              onChange={(provider_id) => setForm({ ...form, provider_id })}
            />
          </Field>
          <Field label="Provider method id">
            <TextInput
              mono
              value={form.method_id}
              onChange={(method_id) => setForm({ ...form, method_id })}
            />
          </Field>
        </div>
        <div className="checkrow" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(event) =>
              setForm({ ...form, is_default: event.target.checked })
            }
          />
          <span>default method</span>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => create.mutate()}>
          Add method
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

function RefundsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const refunds = useQuery({
    queryKey: ["tenant", tenantId, "refund"],
    queryFn: () =>
      unwrap(api.v0.tenant[":id"].refund.$get({ param: { id: tenantId } })),
  });
  const values = useValues();
  const teamMembers = useTeamMembers();
  const [form, setForm] = useState(() => ({
    unique_id: generateId("refund"),
    by: "",
    value: "",
    reason: "",
  }));
  const [lifecycle, setLifecycle] = useState<{
    id: string;
    field: "started_processing_at" | "succeeded_at" | "failed_at";
  } | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (form.by === "" || form.value === "") {
        throw new Error("by and value are required");
      }
      return unwrap(
        api.v0.tenant[":id"].refund.$post({
          param: { id: tenantId },
          json: {
            unique_id: form.unique_id,
            created_at: Date.now(),
            started_processing_at: null,
            succeeded_at: null,
            failed_at: null,
            by: form.by,
            value: form.value,
            reason: form.reason === "" ? null : form.reason,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Refund recorded.");
      s.setError(null);
      setForm({ ...form, unique_id: generateId("refund") });
      s.refresh();
    },
    onError: s.onError,
  });

  const patch = useMutation({
    mutationFn: async (refundId: string) => {
      if (!lifecycle) {
        throw new Error("pick a lifecycle field");
      }
      return unwrap(
        api.v0.tenant[":id"].refund[":refund_id"].$patch({
          param: { id: tenantId, refund_id: refundId },
          json: { [lifecycle.field]: Date.now() },
        }),
      );
    },
    onSuccess: () => {
      setLifecycle(null);
      s.refresh();
    },
    onError: s.onError,
  });

  return (
    <>
      <DataTable
        columns={[
          { header: "Id", cell: (row) => <IdCell id={row.unique_id} /> },
          { header: "Value", cell: (row) => <IdCell id={row.value} /> },
          { header: "By", cell: (row) => <IdCell id={row.by} /> },
          {
            header: "Status",
            cell: (row) =>
              row.succeeded_at ? (
                <span className="pill ok">succeeded</span>
              ) : row.failed_at ? (
                <span className="pill warn">failed</span>
              ) : row.started_processing_at ? (
                <span className="pill">processing</span>
              ) : (
                <span className="pill">created</span>
              ),
          },
          {
            header: "Created",
            cell: (row) => fmtTimestamp(row.created_at),
          },
          {
            header: "",
            cell: (row) =>
              lifecycle?.id === row.unique_id ? (
                <span className="row" style={{ minWidth: 220 }}>
                  <select
                    className="shrink"
                    value={lifecycle.field}
                    onChange={(event) =>
                      setLifecycle({
                        id: row.unique_id,
                        field: event.target.value as typeof lifecycle.field,
                      })
                    }
                  >
                    <option value="started_processing_at">processing</option>
                    <option value="succeeded_at">succeeded</option>
                    <option value="failed_at">failed</option>
                  </select>
                  <button
                    className="small primary shrink"
                    onClick={(event) => {
                      event.stopPropagation();
                      patch.mutate(row.unique_id);
                    }}
                  >
                    Now
                  </button>
                  <button
                    className="small shrink"
                    onClick={(event) => {
                      event.stopPropagation();
                      setLifecycle(null);
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
                    setLifecycle({
                      id: row.unique_id,
                      field: "succeeded_at",
                    });
                  }}
                >
                  Update lifecycle
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No refunds yet."
        keyOf={(row) => row.unique_id}
        rows={refunds.data ?? []}
      />
      <div className="panel">
        <h2>Issue refund</h2>
        <Field label="Id">
          <IdInput
            prefix="refund"
            value={form.unique_id}
            onChange={(unique_id) => setForm({ ...form, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="By (team member)">
            <IdSelect
              placeholder="select a team member"
              value={form.by}
              onChange={(by) => setForm({ ...form, by })}
              options={(teamMembers.data ?? []).map((member) => ({
                id: member.unique_id,
                label: member.name ?? member.email_address,
              }))}
            />
          </Field>
          <Field label="Value">
            <IdSelect
              placeholder="select a value"
              value={form.value}
              onChange={(value) => setForm({ ...form, value })}
              options={(values.data ?? []).map((value) => ({
                id: value.unique_id,
                label: value.name,
              }))}
            />
          </Field>
          <Field label="Reason (optional)">
            <TextInput
              value={form.reason}
              onChange={(reason) => setForm({ ...form, reason })}
            />
          </Field>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => create.mutate()}>
          Issue refund
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Coupons (receipts + grants)
// ---------------------------------------------------------------------------

function CouponsSection() {
  const { tenantId } = Route.useParams();
  const s = useSection();
  const receipts = useQuery({
    queryKey: ["tenant", tenantId, "coupon-receipt"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["coupon-receipt"].$get({
          param: { id: tenantId },
        }),
      ),
  });
  const grants = useQuery({
    queryKey: ["tenant", tenantId, "coupon-grant"],
    queryFn: () =>
      unwrap(
        api.v0.tenant[":id"]["coupon-grant"].$get({
          param: { id: tenantId },
        }),
      ),
  });
  const coupons = useCoupons();
  const tenants = useTenants();
  const teamMembers = useTeamMembers();
  const [receiptForm, setReceiptForm] = useState(() => ({
    unique_id: generateId("coupon_receipt"),
    coupon: "",
    by: "",
    reason: "",
  }));
  const [grantForm, setGrantForm] = useState(() => ({
    unique_id: generateId("coupon_grant"),
    coupon: "",
    to: "",
    reason: "",
  }));

  const createReceipt = useMutation({
    mutationFn: async () => {
      if (receiptForm.coupon === "" || receiptForm.by === "") {
        throw new Error("coupon and by are required");
      }
      return unwrap(
        api.v0.tenant[":id"]["coupon-receipt"].$post({
          param: { id: tenantId },
          json: {
            unique_id: receiptForm.unique_id,
            coupon: receiptForm.coupon,
            on: Date.now(),
            by: receiptForm.by,
            reason: receiptForm.reason === "" ? null : receiptForm.reason,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Coupon granted to tenant.");
      s.setError(null);
      setReceiptForm({
        ...receiptForm,
        unique_id: generateId("coupon_receipt"),
      });
      s.refresh();
    },
    onError: s.onError,
  });

  const useReceipt = useMutation({
    mutationFn: (receiptId: string) =>
      unwrap(
        api.v0.tenant[":id"]["coupon-receipt"][":receipt_id"].use.$post({
          param: { id: tenantId, receipt_id: receiptId },
          json: { used_at: Date.now() },
        }),
      ),
    onSuccess: () => s.refresh(),
    onError: s.onError,
  });

  const createGrant = useMutation({
    mutationFn: async () => {
      if (grantForm.coupon === "" || grantForm.to === "") {
        throw new Error("coupon and recipient tenant are required");
      }
      return unwrap(
        api.v0.tenant[":id"]["coupon-grant"].$post({
          param: { id: tenantId },
          json: {
            unique_id: grantForm.unique_id,
            coupon: grantForm.coupon,
            on: Date.now(),
            to: grantForm.to,
            used_at: null,
            reason: grantForm.reason === "" ? null : grantForm.reason,
          },
        }),
      );
    },
    onSuccess: () => {
      s.setNote("Coupon granted to recipient.");
      s.setError(null);
      setGrantForm({ ...grantForm, unique_id: generateId("coupon_grant") });
      s.refresh();
    },
    onError: s.onError,
  });

  return (
    <>
      <h2>Receipts (coupons this tenant received)</h2>
      <DataTable
        columns={[
          { header: "Coupon", cell: (row) => <IdCell id={row.coupon} /> },
          { header: "On", cell: (row) => fmtTimestamp(row.on) },
          { header: "By", cell: (row) => row.by ?? "—" },
          {
            header: "Used",
            cell: (row) => (row.used_at ? fmtTimestamp(row.used_at) : "—"),
          },
          {
            header: "",
            cell: (row) =>
              row.used_at ? null : (
                <button
                  className="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    useReceipt.mutate(row.unique_id);
                  }}
                >
                  Mark used
                </button>
              ),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No receipts yet."
        keyOf={(row) => row.unique_id}
        rows={receipts.data ?? []}
      />
      <div className="panel">
        <h2>Grant a coupon to this tenant (as a team member)</h2>
        <Field label="Id">
          <IdInput
            prefix="coupon_receipt"
            value={receiptForm.unique_id}
            onChange={(unique_id) =>
              setReceiptForm({ ...receiptForm, unique_id })
            }
          />
        </Field>
        <div className="row">
          <Field label="Coupon">
            <IdSelect
              placeholder="select a coupon"
              value={receiptForm.coupon}
              onChange={(coupon) => setReceiptForm({ ...receiptForm, coupon })}
              options={(coupons.data ?? []).map((coupon) => ({
                id: coupon.unique_id,
                label: coupon.name,
              }))}
            />
          </Field>
          <Field label="By (team member)">
            <IdSelect
              placeholder="select a team member"
              value={receiptForm.by}
              onChange={(by) => setReceiptForm({ ...receiptForm, by })}
              options={(teamMembers.data ?? []).map((member) => ({
                id: member.unique_id,
                label: member.name ?? member.email_address,
              }))}
            />
          </Field>
        </div>
        <button className="primary" onClick={() => createReceipt.mutate()}>
          Grant coupon
        </button>
      </div>

      <h2>Grants (coupons this tenant granted to others)</h2>
      <DataTable
        columns={[
          { header: "Coupon", cell: (row) => <IdCell id={row.coupon} /> },
          { header: "To", cell: (row) => <IdCell id={row.to} /> },
          { header: "On", cell: (row) => fmtTimestamp(row.on) },
          {
            header: "Used",
            cell: (row) => (row.used_at ? fmtTimestamp(row.used_at) : "—"),
          },
        ]}
        expandable={(row) => asJson(row)}
        empty="No grants yet."
        keyOf={(row) => row.unique_id}
        rows={grants.data ?? []}
      />
      <div className="panel">
        <h2>Grant a coupon to another tenant (as this tenant)</h2>
        <Field label="Id">
          <IdInput
            prefix="coupon_grant"
            value={grantForm.unique_id}
            onChange={(unique_id) => setGrantForm({ ...grantForm, unique_id })}
          />
        </Field>
        <div className="row">
          <Field label="Coupon (grantable ones only)">
            <IdSelect
              placeholder="select a coupon"
              value={grantForm.coupon}
              onChange={(coupon) => setGrantForm({ ...grantForm, coupon })}
              options={(coupons.data ?? [])
                .filter((coupon) => coupon.grantable_by_tenants)
                .map((coupon) => ({
                  id: coupon.unique_id,
                  label: coupon.name,
                }))}
            />
          </Field>
          <Field label="Recipient tenant">
            <IdSelect
              placeholder="select a tenant"
              value={grantForm.to}
              onChange={(to) => setGrantForm({ ...grantForm, to })}
              options={(tenants.data ?? []).map((tenant) => ({
                id: tenant.unique_id,
                label: tenant.unique_id,
              }))}
            />
          </Field>
        </div>
        <Feedback error={s.error} note={s.note} />
        <button className="primary" onClick={() => createGrant.mutate()}>
          Grant to tenant
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function TenantDetailPage() {
  const { tenantId } = Route.useParams();
  const queryClient = useQueryClient();
  const tenant = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: () =>
      unwrap(api.v0.tenant[":id"].$get({ param: { id: tenantId } })),
  });
  const [externalIds, setExternalIds] = useState<Record<string, string> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: async () =>
      unwrap(
        api.v0.tenant[":id"].$patch({
          param: { id: tenantId },
          json: { external_ids: externalIds ?? {} },
        }),
      ),
    onSuccess: () => {
      setExternalIds(null);
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
    },
    onError: (e) => setError(messageOf({ error: e })),
  });

  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.v0.tenant[":id"].$delete({ param: { id: tenantId } })),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["tenant"] }),
    onError: (e) => setError(messageOf({ error: e })),
  });

  const data = tenant.data;
  return (
    <Page
      title={tenantId}
      sub={
        data?.deleted_at
          ? `Deleted ${fmtTimestamp(data.deleted_at)}`
          : `Created ${data ? fmtTimestamp(data.created_at) : "…"}`
      }
    >
      {tenant.isLoading ? <Spinner /> : null}
      {data ? (
        <>
          <div className="panel">
            <h2>External ids</h2>
            <KeyValueEditor
              value={externalIds ?? data.external_ids}
              onChange={setExternalIds}
            />
            <ErrorBox error={error} />
            <button
              className="primary"
              disabled={externalIds === null}
              onClick={() => patch.mutate()}
            >
              Save external ids
            </button>{" "}
            {data.deleted_at ? null : (
              <button className="danger" onClick={() => remove.mutate()}>
                Delete tenant
              </button>
            )}
          </div>

          <Section title="Entitlements (live)">
            <EntitlementsSection />
          </Section>
          <Section title="Assignments">
            <AssignmentsSection />
          </Section>
          <Section title="Meter events">
            <MeterEventsSection />
          </Section>
          <Section title="Credit grants">
            <CreditGrantsSection />
          </Section>
          <Section title="Overrides">
            <OverridesSection />
          </Section>
          <Section title="Invoices">
            <InvoicesSection />
          </Section>
          <Section title="Payments">
            <PaymentsSection />
          </Section>
          <Section title="Payment methods">
            <PaymentMethodsSection />
          </Section>
          <Section title="Refunds">
            <RefundsSection />
          </Section>
          <Section title="Coupons">
            <CouponsSection />
          </Section>
        </>
      ) : null}
    </Page>
  );
}
