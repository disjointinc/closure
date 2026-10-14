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

This runs everything on one machine: Closure itself, plus the services it
relies on.

- **Postgres** and **Redis** store Closure's data.
- **[Hatchet](https://hatchet.run)** sends task notifications. It lines them
  up, sends no more than each integration's rate limit allows, and retries
  ones that fail. Its dashboard (http://localhost:3246) shows every
  notification it has sent. Log in as `admin@example.com`, with the password
  `Admin123!!` until you set your own (below).
- **[Nango](https://nango.dev)** stores the logins for Slack, Teams, Linear,
  and Jira, and makes the calls to them. Before anyone can connect one of
  those apps, open the Nango dashboard (http://localhost:3256, username
  `admin`, password `password` until you set your own) and add the app
  there, with the client ID and secret from your own Slack (or Teams, Linear,
  Jira) app. Plain webhooks don't need this.

#### Before using it for real

Out of the box, every password and key is a shared default, which is fine for
trying Closure out but not for anything real. Put your own values in a file
named `.env` next to `compose.yml` (`~/.closure/bin/.env` if you used the
one-liner), then rerun the one-liner.

| Setting                              | What it protects                                   |
| ------------------------------------ | -------------------------------------------------- |
| `CLOSURE_ENV=production`             | Makes Closure refuse to start with the default key |
| `CLOSURE_POSTGRES_PASSWORD`          | The database                                       |
| `CLOSURE_REDIS_PASSWORD`             | Redis                                              |
| `CLOSURE_SECRETS_KEY_V1`             | Webhook passwords and tokens Closure stores        |
| `CLOSURE_NANGO_ENCRYPTION_KEY`       | Slack, Teams, Linear, and Jira logins Nango stores |
| `CLOSURE_NANGO_SECRET_KEY`           | Closure's access to Nango                          |
| `CLOSURE_NANGO_DASHBOARD_PASSWORD`   | The Nango dashboard (username `admin`)             |
| `CLOSURE_HATCHET_DASHBOARD_PASSWORD` | The Hatchet dashboard                              |

For the two keys (`CLOSURE_SECRETS_KEY_V1` and
`CLOSURE_NANGO_ENCRYPTION_KEY`), make a random one with `openssl rand -base64 32`. For the
rest, use letters and numbers only: some of these services put the password
inside a web address, where symbols like `@` or `/` break it.

Three settings can't simply be changed later:

- `CLOSURE_POSTGRES_PASSWORD` only takes effect the first time the database is
  created. Set it before your first run.
- `CLOSURE_HATCHET_DASHBOARD_PASSWORD` is the same: it's only used when
  Hatchet first starts. It needs 8 or more characters, with an uppercase
  letter, a lowercase letter, and a number.
- `CLOSURE_NANGO_ENCRYPTION_KEY` must never change once set. If it does, Nango
  can no longer read the logins it saved, and everyone has to reconnect.

If your webhooks need to reach machines on your own network (like an internal
service at `http://10.0.0.5`), also set
`CLOSURE_OUTBOUND_ALLOW_PRIVATE_NETWORKS=true`. It's off by default so that
nobody can use a webhook to reach machines they shouldn't.

#### Running on an ARM server

Most computers, servers, and Windows machines use Intel or AMD chips, and
everything just works. Macs with Apple chips work too, because Docker Desktop
translates for them automatically.

The one exception is a Linux machine with an ARM chip (like an AWS Graviton
server or a Raspberry Pi). Nango only publishes a version built for Intel and
AMD chips, so it won't start until you install a translator. On Debian or
Ubuntu:

```
sudo apt-get install qemu-user-static
```

You only need to do this once. It keeps working after restarts.

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

#### Task notifications

Hatchet and Nango (see [Self-hosted](#self-hosted-advanced)) start with the
stack, and the API tests need both running.
