// Local dev-loop checks. Expects the full loop to have run:
//   make up bootstrap deploy seed
// Run via `make test` (it injects NANGO_SECRET_KEY), or:
//   NANGO_SECRET_KEY=$(make -s nango-key) node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

const LOCALSTACK = process.env.LOCALSTACK ?? 'http://localhost:4566';
const NANGO = process.env.NANGO_HOSTPORT ?? 'http://localhost:3003';
const SECRET = process.env.NANGO_SECRET_KEY;

const STRIPE_EMU = 'http://stripe.localhost.localstack.cloud:4566';
const HUBSPOT_EMU = 'http://hubspot.localhost.localstack.cloud:4566';

assert.ok(SECRET, 'NANGO_SECRET_KEY must be set (use `make test`)');

const nangoHeaders = (extra = {}) => ({
    Authorization: `Bearer ${SECRET}`,
    'Connection-Id': 'demo',
    ...extra,
});

const proxyGet = (providerConfigKey, baseUrl, path, extra = {}) =>
    fetch(`${NANGO}/proxy${path}`, {
        headers: nangoHeaders({ 'Provider-Config-Key': providerConfigKey, 'Base-Url-Override': baseUrl, ...extra }),
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

test('the Stripe emulator is reachable on its subdomain', async () => {
    const res = await fetch(`${STRIPE_EMU}/v1/customers?limit=1`, {
        headers: { Authorization: 'Bearer sk_test_emulator' },
    });
    assert.equal(res.ok, true, `unexpected status ${res.status}`);
});

test('a customer seeded in the Stripe emulator is readable through the Nango proxy', async () => {
    const email = `proxy-${Date.now()}@example.com`;

    const created = await fetch(`${STRIPE_EMU}/v1/customers`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer sk_test_emulator',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ email, name: 'Proxy Roundtrip' }),
    });
    assert.equal(created.ok, true, `emulator create failed: ${created.status}`);

    const res = await proxyGet('stripe', STRIPE_EMU, '/v1/customers?limit=100');
    assert.equal(res.ok, true, `proxy read failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    const emails = (body.data ?? []).map((c) => c.email);
    assert.ok(emails.includes(email), `expected ${email} in ${JSON.stringify(emails)}`);
});

test('a HubSpot contact is readable through the Nango proxy', async () => {
    const email = `proxy-${Date.now()}@example.com`;

    const created = await fetch(`${HUBSPOT_EMU}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: { Authorization: 'Bearer emulator-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { email, firstname: 'Proxy', lastname: 'Roundtrip' } }),
    });
    assert.equal(created.ok, true, `emulator create failed: ${created.status}`);

    const res = await proxyGet('hubspot', HUBSPOT_EMU, '/crm/v3/objects/contacts?properties=email&limit=100');
    assert.equal(res.ok, true, `proxy read failed: ${res.status} ${await res.text()}`);

    const body = await res.json();
    const emails = (body.results ?? []).map((c) => c.properties?.email);
    assert.ok(emails.includes(email), `expected ${email} in ${JSON.stringify(emails)}`);
});

test('the stripe-customers sync stores records in Nango', async () => {
    const email = `sync-${Date.now()}@example.com`;

    const created = await fetch(`${STRIPE_EMU}/v1/customers`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer sk_test_emulator',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ email, name: 'Sync Roundtrip' }),
    });
    assert.equal(created.ok, true, `emulator create failed: ${created.status}`);

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
