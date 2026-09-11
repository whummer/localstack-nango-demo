// Local dev-loop checks. Expects the full loop to have run:
//   make up bootstrap deploy seed
// Run via `make test` (it injects NANGO_SECRET_KEY), or:
//   NANGO_SECRET_KEY=$(make -s nango-key) node --test tests/
//
// LocalStack's Application Twins are an undocumented, evolving feature, so
// endpoint coverage varies by twin. The hero tests below (Stripe, HubSpot,
// GitHub) assert a full seed -> proxy round trip. The rest are probed for
// reachability and reported, without failing the suite on a single gap -
// see the "Application Twins reachability" test at the bottom.
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

test('a customer seeded in the Stripe twin is readable through the Nango proxy', async () => {
    const email = `proxy-${Date.now()}@example.com`;

    const created = await fetch(`${EMU.stripe}/v1/customers`, {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test_emulator', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, name: 'Proxy Roundtrip' }),
    });
    assert.equal(created.ok, true, `twin create failed: ${created.status}`);

    const res = await proxy('stripe', EMU.stripe, '/v1/customers?limit=100');
    assert.equal(res.ok, true, `proxy read failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    const emails = (body.data ?? []).map((c) => c.email);
    assert.ok(emails.includes(email), `expected ${email} in ${JSON.stringify(emails)}`);
});

test('a contact seeded in the HubSpot twin is readable through the Nango proxy', async () => {
    const email = `proxy-${Date.now()}@example.com`;

    const created = await fetch(`${EMU.hubspot}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: { Authorization: 'Bearer emulator-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { email, firstname: 'Proxy', lastname: 'Roundtrip' } }),
    });
    assert.equal(created.ok, true, `twin create failed: ${created.status}`);

    const res = await proxy('hubspot', EMU.hubspot, '/crm/v3/objects/contacts?properties=email&limit=100');
    assert.equal(res.ok, true, `proxy read failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    const emails = (body.results ?? []).map((c) => c.properties?.email);
    assert.ok(emails.includes(email), `expected ${email} in ${JSON.stringify(emails)}`);
});

test('a repo created in the GitHub twin is readable through the Nango proxy', async () => {
    const name = `demo-repo-${Date.now()}`;

    const created = await fetch(`${EMU.github}/user/repos`, {
        method: 'POST',
        headers: { Authorization: 'Bearer emulator-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    assert.equal(created.ok, true, `twin create failed: ${created.status}`);

    const res = await proxy('github', EMU.github, '/user/repos');
    assert.equal(res.ok, true, `proxy read failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    const names = (Array.isArray(body) ? body : []).map((r) => r.name);
    assert.ok(names.includes(name), `expected ${name} in ${JSON.stringify(names)}`);
});

test('the stripe-customers sync stores records in Nango', async () => {
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
    assert.equal(trigger.ok, true, `sync trigger failed: ${trigger.status} ${await trigger.text()}`);

    let emails = [];
    for (let i = 0; i < 30; i++) {
        await sleep(3000);
        const res = await fetch(`${NANGO}/records?model=StripeCustomer`, {
            headers: nangoHeaders({ 'Provider-Config-Key': 'stripe' }),
        });
        if (!res.ok) continue;
        const body = await res.json();
        emails = (body.records ?? []).map((r) => r.email);
        if (emails.includes(email)) break;
    }
    assert.ok(emails.includes(email), `expected ${email} in synced records, got ${JSON.stringify(emails)}`);
});

// The remaining twins: probe reachability via the Nango proxy and report the
// result for each, without failing the suite over any single one. This is
// exploratory territory (undocumented feature, endpoint coverage unknown) -
// the goal is visibility into what currently works, not a strict contract.
test('Application Twins reachability (informational)', async (t) => {
    const probes = [
        ['twilio', () => proxy('twilio', EMU.twilio, '/2010-04-01/Accounts/AC00000000000000000000000000demo/Messages.json')],
        [
            'linear',
            () =>
                proxy('linear', EMU.linear, '/graphql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: 'query { issues(first: 1) { nodes { id } } }' }),
                }),
        ],
        ['shopify', () => proxy('shopify', EMU.shopify, '/admin/api/2024-01/products.json')],
        ['slack', () => proxy('slack', EMU.slack, '/api/conversations.list')],
        ['posthog', () => proxy('posthog', EMU.posthog, '/api/projects/')],
        [
            'resend',
            () =>
                proxy('resend', EMU.resend, '/emails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: 'demo@localstack-nango-demo.dev', to: 'ada@example.com', subject: 'Hi', text: 'hi' }),
                }),
        ],
        ['logodev', () => proxy('logodev', EMU.logodev, '/stripe.com')],
    ];

    const results = [];
    for (const [key, call] of probes) {
        try {
            const res = await call();
            results.push({ twin: key, status: res.status, ok: res.ok });
        } catch (err) {
            results.push({ twin: key, status: 'error', ok: false, error: String(err) });
        }
    }

    for (const r of results) {
        await t.test(`${r.twin}: ${r.ok ? 'reachable' : `not reachable (${r.status})`}`, () => {});
    }

    const reachable = results.filter((r) => r.ok).length;
    console.log(`Twin reachability: ${reachable}/${results.length} ->`, JSON.stringify(results));
    // Only fail if literally nothing is reachable - that points at the
    // TWINS_ENABLED wiring itself being broken, not a single missing route.
    assert.ok(reachable > 0, `expected at least one twin reachable, got 0/${results.length}: ${JSON.stringify(results)}`);
});
