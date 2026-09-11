# localstack-nango-demo

A sample app that runs a full [Nango](https://www.nango.dev/) integration loop
against LocalStack's **Application Emulators** — emulators of real SaaS APIs
(Stripe, GitHub, Slack, ...) — so you can develop and test third-party
integrations without a single real account and without leaving your machine.

## What this shows

- A self-hosted Nango server, its Postgres and Redis, all in Docker.
- Ten Nango integrations — GitHub, Stripe, Twilio, HubSpot, Linear, Shopify,
  Slack, Resend, PostHog, logo.dev — written in Nango's current zero-yaml
  `createSync`/`createAction` format. All ten deploy and work against Nango
  normally; **5 of them** (Stripe, Twilio, PostHog, Resend, logo.dev) also
  have a real LocalStack Application Emulator to run against locally today.
- Nango's proxy and syncs pointed at the emulators instead of the real APIs, using
  a per-request base URL override.
- One dev loop, `make up bootstrap deploy seed sync test`, that also runs
  unchanged in CI.

> Application Emulators are a new, evolving LocalStack feature and not fully
> documented publicly yet — see [Known gaps](#known-gaps) for exactly which
> integrations have one right now and why.

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
                       │       stripe.  twilio.  posthog.  resend.         │
                       │              logodev.                             │
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

### With a local emulator today

| Twin    | Provider config key | Nango script kind      | Model / action  |
| ------- | -------------------- | ----------------------- | --------------- |
| Stripe  | `stripe`              | sync `stripe-customers` | `StripeCustomer` |
| Twilio  | `twilio`              | sync `twilio-messages`  | `TwilioMessage`  |
| PostHog | `posthog`             | action `capture-event`  | —                |
| Resend  | `resend`              | action `send-email`     | —                |
| logo.dev| `logodev`             | action `fetch-logo` (unauthenticated provider) | — |

### Nango-only for now (no local emulator yet — see Known gaps)

| Integration | Provider config key | Nango script kind              | Model / action |
| ----------- | -------------------- | ------------------------------- | -------------- |
| GitHub      | `github`             | sync `github-repos`             | `GithubRepo`    |
| HubSpot     | `hubspot`             | sync `hubspot-contacts`         | `HubSpotContact`|
| Linear      | `linear`              | sync `linear-issues` (GraphQL)  | `LinearIssue`   |
| Shopify     | `shopify`             | sync `shopify-products`         | `ShopifyProduct`|
| Slack       | `slack`               | sync `slack-channels`           | `SlackChannel`  |

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

Application Emulators are new, undocumented, and evolving. As of this writing:

- **Only 5 emulators exist at all: Stripe, Twilio, PostHog, Resend, logo.dev.**
  Confirmed by reading the `localstack-pro` source (`localstack-pro-apps`) and
  the emulator binary catalog at
  [WonderTwin-AI/registry](https://github.com/WonderTwin-AI/registry) — GitHub,
  HubSpot, Linear, Shopify and Slack simply have no emulator built yet, in
  either place. `docker-compose.yml`'s `TWINS_ENABLED` only requests the 5
  that exist; asking LocalStack to start the other 5 just fails after a
  timeout, for every request, not intermittently. Their Nango integrations
  are still in `nango-integrations/` and deploy fine — Nango itself supports
  all 10 against the real APIs — there's just nothing local to run them
  against yet. `tests/integration.test.mjs` marks those 5 `skip` (not
  `todo`): this isn't a coverage gap that closes on its own.
- **The emulator's plugin name is `logodev`, not `logo.dev`.** Using the
  dotted, brand-accurate form in `TWINS_ENABLED` (an easy mistake — it's what
  the vendor's own domain is called) silently keeps that emulator from ever
  starting. The subdomain is `logodev.localhost.localstack.cloud`.
- **Twilio and Resend never get a working Nango connection**, even though
  their emulators are real. Both use an auth mode (`BASIC` / `API_KEY`) for
  which Nango's own `POST /connections` runs a live credentials check
  against the *real* API (`api.twilio.com` / `api.resend.com`) before
  accepting the connection — there's no way to point that check at the
  emulator instead. `make bootstrap` detects this (`connection_test_failed`)
  and reports it clearly rather than failing the whole loop; their
  syncs/actions still deploy fine, they just have no connection to run
  against locally. `tests/integration.test.mjs` marks both `skip` for this
  reason.
- **PostHog's emulator has no "list projects" endpoint** — per the registry,
  it simulates event capture and feature-flag evaluation (`/capture/`,
  `/decide`), not a projects API. `nango-integrations/posthog/` is an
  action (`capture-event`) rather than a sync for this reason.
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
- **An emulator responds with an S3 `NoSuchBucket` error**: that emulator isn't
  actually mounted — check `make logs` for `Twins: <name> ready at ...` vs
  `Twins: <name> never reported healthy ... not mounting it` at LocalStack
  startup. Only Stripe, Twilio, PostHog, Resend and logo.dev exist as
  emulators right now (see Known gaps); confirm the name in `TWINS_ENABLED`
  matches exactly (`logodev`, not `logo.dev`).
- **`nango deploy` fails with `file_upload_error`**: the `CI=true` env on
  `nango-server` is missing; the server is trying to use S3.
- **`make bootstrap` cannot resolve the secret key**: the Nango server or its
  Postgres is not up yet. Re-run after `make up`.
