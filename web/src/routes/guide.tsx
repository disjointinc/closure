import { createFileRoute } from "@tanstack/react-router";
import { Page } from "./-components/feedback.tsx";

export const Route = createFileRoute("/guide")({
  component: Guide,
});

const API = "http://localhost:3226";

const setupSnippet = `# 1. Create a feature and a meter
curl -X POST ${API}/v0/feature -H 'content-type: application/json' -d '{
  "unique_id": "feature_...",
  "created_at": 1787000000000,
  "deprecated_at": null,
  "name": "Seats",
  "description": null,
  "options": null,
  "applicable_tax_types": null
}'

curl -X POST ${API}/v0/meter -H 'content-type: application/json' -d '{
  "unique_id": "meter_...",
  "created_at": 1787000000000,
  "deprecated_at": null,
  "name": "API calls",
  "description": null,
  "applicable_tax_types": null
}'

# 2. Create a plan that includes them (prices reference a value + cycle,
#    defined inline here or by existing id)
curl -X POST ${API}/v0/plan -H 'content-type: application/json' -d '{
  "unique_id": "plan_...",
  "derived_from": null,
  "created_at": 1787000000000,
  "deprecated_at": null,
  "name": "Pro",
  "description": null,
  "prices": [{
    "cycle": { "unique_id": "cycle_...", "created_at": 1787000000000,
               "deprecated_at": null, "name": "Monthly", "description": null,
               "charged": "upfront", "cycle_length": { "days": null, "months": 1 } },
    "value": { "unique_id": "value_...", "created_at": 1787000000000,
               "deprecated_at": null, "name": "Pro monthly", "description": null,
               "amounts": [{ "currency": "USD", "unit": "cents", "value": 4900 }] }
  }],
  "features": [{ "feature": "feature_...", "set_to": true }],
  "meters": [{ "meter": "meter_...", "default": 1000000, "limit": null,
               "reset": { "days": null, "months": 1 }, "rollovers": null,
               "top_up_prices_per_credit": null, "top_up_credit_pack_sizes": null }],
  "add_ons": null
}'

# 3. Assign the plan to a tenant -- this initializes their meter balances
curl -X POST ${API}/v0/tenant/tenant_.../assignment -H 'content-type: application/json' -d '{
  "unique_id": "assignment_...",
  "plan": "plan_...",
  "experiment": null,
  "cycle": "cycle_...",
  "start": 1787000000000,
  "end": null,
  "add_ons": []
}'`;

const meteringSnippet = `// The hot path: check-and-decrement is one atomic, idempotent call.
// Send unique_external_id to make redeliveries safe.
const response = await fetch(
  \`${API}/v0/tenant/\${tenantId}/meter-event\`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      unique_id: \`meter_event_\${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}\`,
      unique_external_id: request.id, // your idempotency key
      created_at: Date.now(),
      meter: "meter_...",
      amount: 1000, // microcredits; negative amounts refund
    }),
  },
);

if (response.status === 503) {
  // The balance key is being rebuilt from the durable record.
  // Nothing was charged -- retry after a short wait.
  throw new RetryableError("balance temporarily unavailable");
}

const event = await response.json();
if (event.status === "insufficient_balance") {
  // The tenant is out of credits; the event is still recorded durably.
  return res.status(402).json({ error: "insufficient balance" });
}

// event.balance_microcredits is the post-charge balance -- no extra read.
console.log("charged; remaining balance", event.balance_microcredits);`;

const entitlementsSnippet = `// What can this tenant do right now? One call resolves the plan,
// active add-ons, and the latest overrides into a single view.
const entitlements = await fetch(
  \`${API}/v0/tenant/\${tenantId}/entitlements\`,
).then((r) => r.json());

// Feature gating
const seats = entitlements.features.find((f) => f.feature === "feature_...");
const seatsEnabled = seats?.set_to === true;
const enabledOptions = Array.isArray(seats?.set_to) ? seats.set_to : [];

// Usage gating against the live (Redis) balance
const apiCalls = entitlements.meters.find((m) => m.meter === "meter_...");
if ((apiCalls?.balance_microcredits ?? 0) <= 0) {
  return res.status(402).json({ error: "quota exhausted" });
}`;

const paymentSnippet = `// The engine tracks invoices and lifecycle; Stripe moves the money,
// your tax provider computes the tax.

// 1. Create the invoice (items inline; taxes recorded as computed by your
//    tax provider -- e.g. Stripe Tax, Avalara)
const invoice = await fetch(\`${API}/v0/tenant/\${tenantId}/invoice\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    unique_id: "invoice_...",
    created_at: Date.now(),
    closed_at: null,
    closed_reason: null,
    charged: "upfront",
    cycle_length: { days: null, months: 1 },
    items: [{
      unique_id: "item_...",
      per_unit_value: "value_...",
      units: 1,
      name: "Pro plan, monthly",
      description: null,
    }],
    // From your tax provider's calculation:
    taxation_amounts: [{
      unique_id: "taxation_amount_...",
      tax: "tax_...",
      applies_to_items: null, // whole invoice
      notes: "computed by tax provider",
      amount: { currency: "USD", unit: "cents", value: 392 },
    }],
  }),
}).then((r) => r.json());

// 2. Stripe: create the PaymentIntent for the invoice total and record the
//    payment with Stripe's references in provider_internals
const intent = await stripe.paymentIntents.create({
  amount: 5292, // items + taxation_amounts
  currency: "usd",
  customer: tenant.external_ids.stripe,
  payment_method: defaultPaymentMethod.provider_internals.method_id,
  off_session: true,
  confirm: true,
});

const payment = await fetch(\`${API}/v0/tenant/\${tenantId}/payment\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    unique_id: "payment_...",
    created_at: Date.now(),
    started_processing_at: Date.now(),
    succeeded_at: null,
    failed_at: null,
    provider_internals: {
      id: "stripe",
      payment_id: intent.id,
      customer_id: intent.customer,
    },
    invoices: [invoice.unique_id],
  }),
}).then((r) => r.json());

// 3. Stripe webhooks drive the lifecycle timestamps:
await fetch(\`${API}/v0/tenant/\${tenantId}/payment/\${payment.unique_id}\`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ succeeded_at: Date.now() }), // or failed_at
});`;

function Snippet({ code }: { code: string }) {
  return (
    <pre className="snippet">
      <code>{code}</code>
    </pre>
  );
}

function Guide() {
  return (
    <Page
      title="Using the API"
      sub="Copyable flows for the three things Closure does: metering, entitlements, and the payment lifecycle."
    >
      <div className="guide">
        <h3>1. Metering (the hot path)</h3>
        <p>
          Meter events decrement the tenant's Redis balance atomically and flush
          to Postgres in batches. Recording is idempotent on{" "}
          <code>unique_external_id</code>; a <code>503</code> means the balance
          key is being rebuilt and nothing was charged.
        </p>
        <Snippet code={meteringSnippet} />

        <h3>2. Entitlements</h3>
        <p>
          One call resolves the current assignment's plan, active add-ons, and
          the latest overrides into what the tenant can do and how much they
          have left.
        </p>
        <Snippet code={entitlementsSnippet} />

        <h3>3. Processing a payment</h3>
        <p>
          Closure tracks invoices, payments, and refunds; Stripe (or another
          provider) moves the money, and your tax provider computes the tax
          recorded on the invoice.
        </p>
        <Snippet code={paymentSnippet} />

        <h3>4. Setup walkthrough</h3>
        <p>
          From nothing to a tenant with live balances: define a feature and a
          meter, compose a plan, then assign it (assignment initializes the
          tenant's meter balances from the plan defaults).
        </p>
        <Snippet code={setupSnippet} />
      </div>
    </Page>
  );
}
