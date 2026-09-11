# localstack-nango-demo

A sample app that runs a full [Nango](https://www.nango.dev/) integration loop
against LocalStack's **Application Emulators** — emulators of real SaaS APIs
(Stripe, GitHub, Slack, ...) — so you can develop and test third-party
integrations without a single real account and without leaving your machine.

## What this shows

- A self-hosted Nango server, its Postgres and Redis, all in Docker.
- Ten integrations, one per Application Emulator: GitHub, Stripe, Twilio, HubSpot,
  Linear, Shopify, Slack, Resend, PostHog, logo.dev — written in Nango's
  current zero-yaml `createSync`/`createAction` format.
- Nango's proxy and syncs pointed at the emulators instead of the real APIs, using
  a per-request base URL override.
- One dev loop, `make up bootstrap deploy seed sync test`, that also runs
  unchanged in CI.

> Application Emulators are a new, evolving LocalStack feature and not fully
> documented publicly yet. Endpoint coverage varies by emulator — see
> [Known gaps](#known-gaps).

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
                       ┌───────────────────────────────────────────────────┐
                       │     LocalStack Application Emulators       :4566  │
                       │   github. stripe. twilio. hubspot. linear.        │
                       │   shopify. slack. resend. posthog. logo.dev.      │
                       │          localhost.localstack.cloud               │
                       └───────────────────────────────────────────────────┘
```

## How the proxy reaches the emulators

Nango's egress guard **always** blocks loopback targets, and
`*.localhost.localstack.cloud` resolves to `127.0.0.1` on the host. So the demo
routes around loopback:

1. LocalStack is started with `TWINS_ENABLED=<comma-separated emulator names>`,
   which mounts each emulator on its own `<name>.localhost.localstack.cloud`
   subdomain (routed by the request `Host` header).
2. The LocalStack container gets compose network **aliases** for each of those
   subdomains. From the Nango container those names resolve to LocalStack's
   *private container IP*, not `127.0.0.1`.
3. `NANGO_OUTBOUND_URL_POLICY` is set to permissive with `blockPrivateIps:false`
   so the proxy is allowed to call that private IP. **Development only.**

This mechanism (env var name, subdomain-per-emulator, the loopback pitfall) is not
in LocalStack's public docs yet; it was worked out from
https://github.com/localstack/finance-ops/pull/7.

Two more self-hosted Nango details the demo handles for you:

- The Nango CLI needs the server's `dev` environment secret key. On a fresh
  self-hosted server it is a generated UUID in Postgres;
  `scripts/lib.sh nango_secret_key` reads it (`make nango-key`).
- `nango deploy` on the hosted image wants an S3 bucket for the compiled
  bundles. Setting `CI=true` on the server (see `docker-compose.yml`) switches
  it to on-disk storage instead.

## Prerequisites

- Docker and Docker Compose v2
- Node.js 20+
- A LocalStack auth token with Application Emulators enabled
  (https://app.localstack.cloud). This is a LocalStack Pro capability.

## Quickstart

```bash
cp .env.example .env
# set LOCALSTACK_AUTH_TOKEN, and NANGO_ENCRYPTION_KEY (openssl rand -base64 32)

make up          # start LocalStack + Nango (server, db, redis)
make bootstrap   # register the 10 provider configs and a demo connection each
make deploy      # compile + push the integration scripts to the local server
make seed        # create sample data inside the emulators
make sync        # trigger the syncs, print the records Nango stored
make demo        # read/write the same data through the Nango proxy
make test        # run the local dev-loop test suite
make down        # stop everything
```

`make` on its own prints every target with a description. `make ci` runs the
whole loop end to end.

> Deployed bundles live on the Nango container's filesystem, so re-run
> `make deploy` after `make down` + `make up`.

## Integrations

| Emulator    | Provider config key | Nango script kind        | Model / action    |
| ------- | -------------------- | ------------------------ | ------------------ |
| GitHub  | `github`             | sync `github-repos`      | `GithubRepo`        |
| Stripe  | `stripe`              | sync `stripe-customers`  | `StripeCustomer`    |
| Twilio  | `twilio`              | sync `twilio-messages`   | `TwilioMessage`     |
| HubSpot | `hubspot`             | sync `hubspot-contacts`  | `HubSpotContact`    |
| Linear  | `linear`              | sync `linear-issues` (GraphQL) | `LinearIssue` |
| Shopify | `shopify`             | sync `shopify-products`  | `ShopifyProduct`    |
| Slack   | `slack`               | sync `slack-channels`    | `SlackChannel`      |
| Resend  | `resend`              | action `send-email`      | —                   |
| PostHog | `posthog`             | sync `posthog-projects`  | `PosthogProject`    |
| logo.dev| `logodev`             | action `fetch-logo` (unauthenticated provider) | — |

## Project layout

```
docker-compose.yml            LocalStack (Application Emulators) + Nango stack
Makefile                      self-describing entrypoint for every task
.env.example                  required configuration
nango-integrations/
  package.json / tsconfig     managed by the Nango CLI
  index.ts                    imports every script
  <emulator>/syncs|actions/       createSync/createAction + zod, proxy pointed at the emulator
scripts/
  lib.sh                      shared helpers (wait_for, nango_secret_key)
  bootstrap.sh                create provider configs + connections via the API
  deploy.sh                   nango deploy, one sync/action at a time
  seed-emulators.sh           create sample records in the emulators
  run-syncs.sh                trigger syncs, poll Nango records
  demo.sh                     read/write through the Nango proxy
tests/
  integration.test.mjs        end-to-end checks (node --test)
.github/workflows/ci.yml      the same loop, in CI
```

## CI

`.github/workflows/ci.yml` runs the identical loop on every push and PR. It
needs one repository secret:

- `LOCALSTACK_AUTH_TOKEN` (required, Application Emulators are Pro)
- `NANGO_ENCRYPTION_KEY` (optional, a throwaway key is generated if unset)

## Known gaps

Application Emulators are new and evolving, so:

- **Twilio and Resend never get a working connection here.** Both use an
  auth mode (`BASIC` / `API_KEY`) for which Nango's own `POST /connections`
  runs a live credentials check against the *real* API
  (`api.twilio.com` / `api.resend.com`) before accepting the connection —
  there's no way to point that check at the emulator instead. `make bootstrap`
  detects this (`connection_test_failed`) and reports it clearly rather than
  failing the whole loop; their syncs/actions still deploy fine, they just
  have no connection to run against locally.
- **Most emulators currently implement `POST` (create) but not `GET` (read).**
  Every emulator routes `POST` correctly, but a `GET` to the same emulator mostly
  falls through to LocalStack's default S3 handler instead (a `NoSuchBucket`
  XML error). As of this writing only Stripe and Linear round-trip a create
  → proxy-read; `tests/integration.test.mjs` reports every emulator's outcome
  without failing the suite over a single missing route, since this is
  endpoint coverage, not a wiring bug: a raw echo server swapped in for a
  emulator on the same docker network confirmed the Nango proxy sends the
  correct `Host` header (which is what LocalStack's emulator routing keys off)
  for `GET` and `POST` alike, so the gap is inside the emulator/LocalStack
  routing, not in this repo or in Nango.
- `scripts/bootstrap.sh` reads each provider's auth mode from Nango's own
  `GET /providers/<name>` rather than hardcoding it, so it adapts if that
  changes; `scripts/deploy.sh` deploys one sync/action at a time so a
  provider that didn't bootstrap doesn't block the others.

## Troubleshooting

- **`make up` fails on LocalStack**: check `LOCALSTACK_AUTH_TOKEN` and that
  your plan includes Application Emulators. `make logs` tails both stacks.
- **Proxy calls return `base_url_override_not_allowed`**: the emulator hostname
  resolved to `127.0.0.1` instead of the LocalStack container. Confirm the
  network aliases in `docker-compose.yml` and that LocalStack is up.
- **A emulator responds with an S3 `NoSuchBucket` error**: that emulator isn't
  actually mounted — check `TWINS_ENABLED` and the emulator's spelling, and check
  `make logs` for `loaded N emulators` at LocalStack startup.
- **`nango deploy` fails with `file_upload_error`**: the `CI=true` env on
  `nango-server` is missing; the server is trying to use S3.
- **`make bootstrap` cannot resolve the secret key**: the Nango server or its
  Postgres is not up yet. Re-run after `make up`.
