# Closure

Closure is a system for metering, entitlements, and billing. Closure lets you build powerful functionality on top of these primitives, like:

1. Actioning and alerting on customer lifecycle events
1. Granting discounts and referral bonuses
1. Experimenting with plans and pricing
1. Processing buy-now-pay-later
1. Modeling marginal revenue and expenses

and more! It's built on a few principles:

1. Pricing should be managed in code
1. Pricing is always being tweaked
1. Plans are versioned and immutable
1. Assignments almost always tweak plan settings
1. Metering shouldn't introduce a visible delay for users
1. Metering events should be idempotent
1. Tasks should be created immediately when metering thresholds are hit
1. Sensitive payment info shouldn't be stored on your servers
1. 3P providers should process payment and calculate taxes

## Getting started

### Guided (recommended)

We'll be making a managed version soon.

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

Default UI is available at http://localhost:3226.

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

Note: unlike other API changes, all web changes, and all docs changes, DB migrations must be applied before they take effect. No hot-reloading.

#### Ports

To change a port, set its env var before starting the stack (in your shell or
in `bin/.env`). Everything follows it: Docker, tests, and scripts.

| Env var                      | Default | Serves                |
| ---------------------------- | ------- | --------------------- |
| `CLOSURE_POSTGRES_PORT`      | 54326   | Postgres              |
| `CLOSURE_REDIS_PORT`         | 63796   | Redis                 |
| `CLOSURE_API_PORT`           | 3216    | API                   |
| `CLOSURE_WEB_PORT`           | 3226    | Web console           |
| `CLOSURE_DOCS_PORT`          | 3236    | Docs site             |
| `CLOSURE_HATCHET_PORT`       | 3246    | Hatchet dashboard     |
| `CLOSURE_HATCHET_GRPC_PORT`  | 3247    | Hatchet (workers)     |
| `CLOSURE_NANGO_PORT`         | 3256    | Nango API + dashboard |
| `CLOSURE_NANGO_CONNECT_PORT` | 3257    | Nango Connect UI      |

#### Task notification integrations

Task notifications are delivered through two self-hosted services that start
with the stack:

- [Hatchet](https://hatchet.run) queues each notification, holds it to its
  integration's rate limit, and retries it. Its dashboard (default login
  `admin@example.com` / `Admin123!!`) shows every run.
- [Nango](https://nango.dev) stores Slack, Teams, Linear, and Jira
  credentials and makes the calls to them. Before anyone can connect one of
  those systems, add its integration (your OAuth app's client ID and secret)
  in the Nango dashboard. Webhook integrations don't need Nango.

For any real deploy, set your own `CLOSURE_NANGO_ENCRYPTION_KEY` (32 random
bytes, base64; never change it after), `CLOSURE_NANGO_SECRET_KEY`, and
`CLOSURE_NANGO_DASHBOARD_PASSWORD` in `bin/.env`, and your own
`CLOSURE_SECRETS_KEY_V1` (32 random bytes, base64) for webhook secrets.
`CLOSURE_POSTGRES_PASSWORD` and `CLOSURE_REDIS_PASSWORD` set every service's
database and Redis passwords; keep them URL-safe (letters, digits, `-._~`),
since Hatchet and Nango read them inside connection URLs. The Postgres
password only takes effect when its volume is first created.
Tests need Hatchet and Nango running.

Nango only publishes amd64 images. On x64 machines (including Windows) and
on Apple Silicon (through Docker Desktop's emulation) it just runs. On ARM
Linux hosts (e.g. AWS Graviton, Raspberry Pi), install amd64 emulation once
before starting the stack:

```
docker run --privileged --rm tonistiigi/binfmt --install amd64
```
