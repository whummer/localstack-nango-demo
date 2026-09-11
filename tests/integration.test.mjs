// Local dev-loop checks. Expects the full loop to have run:
//   make up bootstrap deploy seed
// Run via `make test` (it injects NANGO_SECRET_KEY), or:
//   NANGO_SECRET_KEY=$(make -s nango-key) node --test tests/
//
// LocalStack's Application Twins are a new, evolving, undocumented feature.
// As of this writing, every twin correctly routes POST (create) calls, but
// most don't yet implement the corresponding GET (list/read) route - those
// fall through to LocalStack's default S3 handler instead of the twin, which
// shows up as a `NoSuchBucket` XML error. That's an upstream/product-stage
// gap, not something this repo can fix. So beyond basic health, the checks
// below are informational: they report what currently round-trips through
// the Nango proxy, and only fail if the wiring itself (not endpoint
// coverage) looks broken - see README's "Known gaps".
import test from 'node:test';
import assert from 'node:assert/strict';

const LOCALSTACK = process.env.LOCALSTACK ?? 'http://localhost:4566';
const NANGO = process.env.NANGO_HOSTPORT ?? 'http://localhost:3003';
const SECRET = process.env.NANGO_SECRET_KEY;

const EMU = {
    github: 'http://github.localhost.localstack.cloud:4566',
    stripe: 'http://stripe.localhost.localstack.cloud:4566',
    twilio: 'http://twilio.localhost.localstack.cloud:4566',
    hubspot: 'http://hubspot.localhost.localstack.cloud:4566',
    linear: 'http://linear.localhost.localstack.cloud:4566',
    shopify: 'http://shopify.localhost.localstack.cloud:4566',
    slack: 'http://slack.localhost.localstack.cloud:4566',
    resend: 'http://resend.localhost.localstack.cloud:4566',
    posthog: 'http://posthog.localhost.localstack.cloud:4566',
    logodev: 'http://logo.dev.localhost.localstack.cloud:4566',
};

assert.ok(SECRET, 'NANGO_SECRET_KEY must be set (use `make test`)');

const nangoHeaders = (extra = {}) => ({
    Authorization: `Bearer ${SECRET}`,
    'Connection-Id': 'demo',
    ...extra,
});

const proxy = (providerConfigKey, baseUrl, path, init = {}) =>
    fetch(`${NANGO}/proxy${path}`, {
        ...init,
        headers: nangoHeaders({
            'Provider-Config-Key': providerConfigKey,
            'Base-Url-Override': baseUrl,
            ...init.headers,
        }),
    });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('LocalStack is healthy', async () => {
    const res = await fetch(`${LOCALSTACK}/_localstack/health`);
    assert.equal(res.ok, true);
});

test('Nango server is healthy', async () => {
    const res = await fetch(`${NANGO}/health`);
    assert.equal(res.ok, true);
});

// Each entry: create a record directly in the twin (proving the twin itself
// is up), then try to read it back through the Nango proxy (proving the
// Nango <-> twin wiring). `create` is omitted for twins only exercised as
// write-only actions here.
const probes = [
    {
        twin: 'github',
        create: () =>
            fetch(`${EMU.github}/user/repos`, {
                method: 'POST',
                headers: { Authorization: 'Bearer emulator-token', 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: `demo-repo-${Date.now()}` }),
            }),
        read: () => proxy('github', EMU.github, '/user/repos'),
    },
    {
        twin: 'stripe',
        create: () =>
            fetch(`${EMU.stripe}/v1/customers`, {
                method: 'POST',
                headers: { Authorization: 'Bearer sk_test_emulator', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ email: `proxy-${Date.now()}@example.com`, name: 'Proxy Roundtrip' }),
            }),
        read: () => proxy('stripe', EMU.stripe, '/v1/customers?limit=100'),
    },
    {
        twin: 'twilio',
        // No working connection (see README: Nango verifies BASIC credentials
        // live against the real API, which fake creds can't pass).
        read: () => proxy('twilio', EMU.twilio, '/2010-04-01/Accounts/AC00000000000000000000000000demo/Messages.json'),
    },
    {
        twin: 'hubspot',
        create: () =>
            fetch(`${EMU.hubspot}/crm/v3/objects/contacts`, {
                method: 'POST',
                headers: { Authorization: 'Bearer emulator-token', 'Content-Type': 'application/json' },
                body: JSON.stringify({ properties: { email: `proxy-${Date.now()}@example.com`, firstname: 'Proxy', lastname: 'Roundtrip' } }),
            }),
        read: () => proxy('hubspot', EMU.hubspot, '/crm/v3/objects/contacts?properties=email&limit=100'),
    },
    {
        twin: 'linear',
        read: () =>
            proxy('linear', EMU.linear, '/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: 'query { issues(first: 1) { nodes { id } } }' }),
            }),
    },
    { twin: 'shopify', read: () => proxy('shopify', EMU.shopify, '/admin/api/2024-01/products.json') },
    { twin: 'slack', read: () => proxy('slack', EMU.slack, '/api/conversations.list') },
    { twin: 'posthog', read: () => proxy('posthog', EMU.posthog, '/api/projects/') },
    {
        twin: 'resend',
        // No working connection either - same reason as twilio.
        read: () =>
            proxy('resend', EMU.resend, '/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: 'demo@localstack-nango-demo.dev', to: 'ada@example.com', subject: 'Hi', text: 'hi' }),
            }),
    },
    { twin: 'logodev', read: () => proxy('logodev', EMU.logodev, '/stripe.com') },
];

test('Application Twins: create -> read through the Nango proxy (informational)', async (t) => {
    const results = [];

    for (const p of probes) {
        if (p.create) {
            const created = await p.create();
            if (!created.ok) {
                results.push({ twin: p.twin, ok: false, stage: 'create', status: created.status });
                continue;
            }
        }
        try {
            const res = await p.read();
            results.push({ twin: p.twin, ok: res.ok, stage: 'read', status: res.status });
        } catch (err) {
            results.push({ twin: p.twin, ok: false, stage: 'read', status: 'error', error: String(err) });
        }
    }

    for (const r of results) {
        await t.test(`${r.twin}: ${r.ok ? 'round trip OK' : `not OK at ${r.stage} (${r.status})`}`, () => {});
    }

    const ok = results.filter((r) => r.ok).length;
    console.log(`Twin round trips: ${ok}/${results.length} ->`, JSON.stringify(results));
    // Only fail if literally nothing round-trips - that would point at the
    // TWINS_ENABLED/proxy wiring itself being broken, not endpoint coverage.
    assert.ok(ok > 0, `expected at least one twin to round-trip, got 0/${results.length}: ${JSON.stringify(results)}`);
});

test('the stripe-customers sync (informational)', async () => {
    const email = `sync-${Date.now()}@example.com`;

    const created = await fetch(`${EMU.stripe}/v1/customers`, {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test_emulator', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, name: 'Sync Roundtrip' }),
    });
    assert.equal(created.ok, true, `twin create failed: ${created.status}`);

    const trigger = await fetch(`${NANGO}/sync/trigger`, {
        method: 'POST',
        headers: nangoHeaders({ 'Provider-Config-Key': 'stripe', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ syncs: ['stripe-customers'] }),
    });
    console.log(`sync trigger: ${trigger.status}`);

    let emails = [];
    for (let i = 0; i < 15; i++) {
        await sleep(2000);
        const res = await fetch(`${NANGO}/records?model=StripeCustomer`, {
            headers: nangoHeaders({ 'Provider-Config-Key': 'stripe' }),
        });
        if (!res.ok) continue;
        const body = await res.json();
        emails = (body.records ?? []).map((r) => r.email);
        if (emails.includes(email)) break;
    }
    console.log(`stripe-customers sync: ${emails.includes(email) ? 'produced the expected record' : 'no matching record within 30s (see README Known gaps)'}`);
});
