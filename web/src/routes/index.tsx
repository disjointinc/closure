import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "./-components/feedback.tsx";
import {
  useAddOns,
  useCoupons,
  useCouponTemplates,
  useExperiments,
  useFeatures,
  useMeters,
  usePlans,
  useTaxes,
  useTeamMembers,
  useTenants,
} from "../lib/queries.ts";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const cards = [
  { label: "Tenants", to: "/tenants", useList: useTenants },
  { label: "Plans", to: "/plans", useList: usePlans },
  { label: "Add-ons", to: "/add-ons", useList: useAddOns },
  { label: "Features", to: "/features", useList: useFeatures },
  { label: "Meters", to: "/meters", useList: useMeters },
  { label: "Taxes", to: "/taxes", useList: useTaxes },
  {
    label: "Coupon templates",
    to: "/coupon-templates",
    useList: useCouponTemplates,
  },
  { label: "Coupons", to: "/coupons", useList: useCoupons },
  { label: "Experiments", to: "/experiments", useList: useExperiments },
  { label: "Team members", to: "/team-members", useList: useTeamMembers },
] as const;

function CountCard({ card }: { card: (typeof cards)[number] }) {
  // Counts derive from the shared list queries: a query key must always hold
  // one data shape, and caching a count here broke the catalog pages.
  const list = card.useList();
  return (
    <Link className="card" to={card.to}>
      <div className="n">{list.data?.length ?? "…"}</div>
      <div className="t">{card.label}</div>
    </Link>
  );
}

function Dashboard() {
  return (
    <Page
      title="Dashboard"
      sub="Everything in your Closure engine, at a glance."
    >
      <div className="cards">
        {cards.map((card) => (
          <CountCard key={card.label} card={card} />
        ))}
      </div>
      <h2 style={{ marginTop: 24 }}>Guide</h2>
      <p className="muted">
        New here? <Link to="/guide">Using the API</Link> walks through metering,
        entitlements, and the payment lifecycle with copyable snippets.
      </p>
    </Page>
  );
}
