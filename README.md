# Closure

Real-time, configurable metering, entitlements, pricing, referrals, and billing. Built on a few principles:

1. Pricing should be managed in code
1. Pricing is always being tweaked
1. Plans are versioned and immutable
1. Metering shouldn't introduce a visible delay for users
1. Metering events should be idempotent
1. Sensitive payment info shouldn't be stored on your servers
1. 3P providers should process payment and calculate taxes

## Getting started

### Guided (recommended)

Sign up for free at [disjoint.com](https://www.disjoint.com). Closure is enabled by default for all Disjoint users. We do some more nice things:

1. Set up entitlement and metering checks in your codebase
1. Set up payment processing and taxation
1. Correlate your pricing with your internal costs
1. Integrate with the rest of the [Disjoint tool suite](https://www.disjoint.com/tools)

### Self-hosted (advanced)

If you want to self-host, you can deploy a hobby instance in one line on Linux using Docker.

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/disjointinc/closure/HEAD/bin/deploy-hobby)"
```

## Contributing

We love contributions! We'll have a contributing guidelines section soon.

### Developing locally

Run the whole stack (Postgres, Redis, API, web) in Docker from your checkout:

```
docker compose -p closure -f bin/compose.yml up -d
```

Default UI is available at http://localhost:3216.

This starts the same services as the one-liner above: `deploy-hobby` uses the
checkout's `bin/compose.yml` when run from a clone, so both paths produce the
same result. (The curl one-liner just runs a pristine snapshot downloaded to
`~/.closure` instead of your working tree.)

Code changes are picked up live: the API restarts itself on file changes
(`node --watch`), and the web app hot-reloads (Vite).

#### Migrations

The API's database schema lives in `api/db/schema.ts` (Drizzle). To change it:

1. Edit `api/db/schema.ts`.
1. Generate the SQL: `npm run db:generate -w api` (writes `api/db/migrations/`).
1. Apply it. Pending migrations run automatically on the next
   `docker compose -p closure -f bin/compose.yml up -d` (via the one-shot
   `closure-migrate` service), or apply them to your local db immediately with
   `npm run db:migrate -w api`.
