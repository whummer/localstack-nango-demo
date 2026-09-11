# localstack-nango-demo

A sample app that runs a full [Nango](https://www.nango.dev/) integration loop
against [LocalStack application emulators](https://www.localstack.cloud/), so you
can develop and test third-party integrations (Stripe, Xero, HubSpot, ...)
without a single real SaaS account and without leaving your machine.

## What this shows

- A self-hosted Nango server, its Postgres and Redis, all in Docker.
- Three integrations from Nango's catalog (https://nango.dev/api-integrations):
  Stripe, Xero and HubSpot, written in the current zero-yaml `createSync` format.
- Nango's proxy and syncs pointed at LocalStack's app emulators instead of the
  real APIs, using a per-request base URL override.
- One dev loop, `make up bootstrap deploy seed sync test`, that also runs
  unchanged in CI.

## Architecture

```
  ┌─────────────┐   nango deploy            ┌──────────────────────────┐
  │  Nango CLI  │ ───────────────────────▶  │   Nango server           │
  └─────────────┘   compile + upload        │   (self-hosted, Docker)  │
                                            │   localhost:3003         │
  ┌─────────────┐   POST /proxy, /sync      │                          │
  │ demo / CI   │ ───────────────────────▶  │   proxy + sync engine    │
  │   tests     │ ◀───────────────────────  │                          │
  └─────────────┘   records / responses     └───────────┬──────────────┘
                                                        │ base URL override
                                                        ▼
                            ┌───────────────────────────────────────────┐
                            │   LocalStack app emulators   :4566        │
                            │   stripe.  |  xero.  |  hubspot.          │
                            │        localhost.localstack.cloud         │
                            └───────────────────────────────────────────┘
```

## How the proxy reaches the emulators

Nango's egress guard **always** blocks loopback targets, and
`*.localhost.localstack.cloud` resolves to `127.0.0.1` on the host. So the demo
routes around loopback:

1. The LocalStack container gets compose network **aliases**
   (`stripe.localhost.localstack.cloud`, ...). From the Nango container those
   names resolve to LocalStack's *private container IP*, not `127.0.0.1`.
2. `NANGO_OUTBOUND_URL_POLICY` is set to permissive with `blockPrivateIps:false`
   so the proxy is allowed to call that private IP. **Development only.**
3. The emulators route on the request `Host` header, which the override URL sets
   to `stripe.localhost.localstack.cloud` and friends.

Two more self-hosting details the demo handles for you:

- The Nango CLI needs the server's `dev` environment secret key. On a fresh
  self-hosted server it is a generated UUID in Postgres;
  `scripts/lib.sh nango_secret_key` reads it (`make nango-key`).
- `nango deploy` on the hosted image wants an S3 bucket for the compiled
  bundles. Setting `CI=true` on the server (see `docker-compose.yml`) switches
  it to on-disk storage instead.

## Prerequisites

- Docker and Docker Compose v2
- Node.js 20+
- A LocalStack auth token with the app emulators feature
  (https://app.localstack.cloud). App emulators are a LocalStack Pro capability.

## Quickstart

```bash
cp .env.example .env
# set LOCALSTACK_AUTH_TOKEN, and NANGO_ENCRYPTION_KEY (openssl rand -base64 32)

make up          # start LocalStack + Nango (server, db, redis)
make bootstrap   # register the 3 provider configs and a demo connection each
make deploy      # compile + push the integration scripts to the local server
make seed        # create sample data inside the Stripe/Xero/HubSpot emulators
make sync        # trigger the syncs, print the records Nango stored
make demo        # read the same data back through the Nango proxy
make test        # run the local dev-loop test suite
make down        # stop everything
```

`make` on its own prints every target with a description. `make ci` runs the
whole loop end to end.

> Deployed bundles live on the Nango container's filesystem, so re-run
> `make deploy` after `make down` + `make up`.

## Integrations

| Provider config key | Nango provider | Emulator base URL                                | Model / data     |
| ------------------- | -------------- | ----------------------------------------------- | ---------------- |
| `stripe`            | `stripe`       | `http://stripe.localhost.localstack.cloud:4566`  | `StripeCustomer` |
| `xero`              | `xero`         | `http://xero.localhost.localstack.cloud:4566`    | `XeroInvoice`    |
| `hubspot`           | `hubspot`      | `http://hubspot.localhost.localstack.cloud:4566` | `HubSpotContact` |

## Project layout

```
docker-compose.yml            LocalStack + Nango stack
Makefile                      self-describing entrypoint for every task
.env.example                  required configuration
nango-integrations/
  package.json / tsconfig     managed by the Nango CLI
  index.ts                    imports every script
  stripe/syncs/               createSync + zod, proxy pointed at the emulator
  xero/syncs/
  hubspot/syncs/
scripts/
  lib.sh                      shared helpers (wait_for, nango_secret_key)
  bootstrap.sh                create provider configs + connections via the API
  deploy.sh                   nango deploy against the local server
  seed-emulators.sh           create sample records in the emulators
  run-syncs.sh                trigger syncs, poll Nango records
  demo.sh                     read records back through the Nango proxy
tests/
  integration.test.mjs        end-to-end checks (node --test)
.github/workflows/ci.yml      the same loop, in CI
```

## CI

`.github/workflows/ci.yml` runs the identical loop on every push and PR. It
needs one repository secret:

- `LOCALSTACK_AUTH_TOKEN` (required, app emulators are Pro)
- `NANGO_ENCRYPTION_KEY` (optional, a throwaway key is generated if unset)

## Troubleshooting

- **`make up` fails on LocalStack**: check `LOCALSTACK_AUTH_TOKEN` and that your
  plan includes app emulators. `make logs` tails both stacks.
- **Proxy calls return `base_url_override_not_allowed`**: the emulator hostname
  resolved to `127.0.0.1` instead of the LocalStack container. Confirm the
  network aliases in `docker-compose.yml` and that LocalStack is up.
- **`nango deploy` fails with `file_upload_error`**: the `CI=true` env on
  `nango-server` is missing; the server is trying to use S3.
- **`make bootstrap` cannot resolve the secret key**: the Nango server or its
  Postgres is not up yet. Re-run after `make up`.
