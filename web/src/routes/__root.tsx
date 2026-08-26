import { useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Closure" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: RootComponent,
});

const catalogLinks = [
  { label: "Plans", to: "/plans" },
  { label: "Add-ons", to: "/add-ons" },
  { label: "Features", to: "/features" },
  { label: "Meters", to: "/meters" },
  { label: "Taxes", to: "/taxes" },
  { label: "Coupon templates", to: "/coupon-templates" },
  { label: "Coupons", to: "/coupons" },
  { label: "Experiments", to: "/experiments" },
] as const;

function NavLink({ label, to }: { label: string; to: string }) {
  return (
    <Link to={to} activeProps={{ className: "active" }}>
      {label}
    </Link>
  );
}

function HealthPill() {
  // Rendered only after mount: the answer differs server-side vs client-side
  // (and stale SSR HTML would otherwise mismatch hydration).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const health = useQuery({
    queryKey: ["healthz"],
    enabled: mounted,
    queryFn: async () => {
      const response = await fetch("http://localhost:3226/healthz");
      return response.ok;
    },
    refetchInterval: 30_000,
  });
  if (!mounted) {
    return null;
  }
  return (
    <span className={`pill ${health.data ? "ok" : "warn"}`} title="API health">
      {health.data ? "api up" : "api down"}
    </span>
  );
}

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="shell">
          <nav className="sidenav">
            <div className="brand">
              Closure <HealthPill />
            </div>
            <div className="group">
              <NavLink label="Dashboard" to="/" />
              <NavLink label="Tenants" to="/tenants" />
            </div>
            <div className="group">
              <div className="group-label">Catalog</div>
              {catalogLinks.map((link) => (
                <NavLink key={link.to} {...link} />
              ))}
            </div>
            <div className="group">
              <div className="group-label">People</div>
              <NavLink label="Team members" to="/team-members" />
            </div>
            <div className="group">
              <div className="group-label">Docs</div>
              <NavLink label="Using the API" to="/guide" />
            </div>
          </nav>
          <main className="main">
            <Outlet />
          </main>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
