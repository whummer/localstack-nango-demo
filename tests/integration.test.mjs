// Local dev-loop checks. Requires `make up` (and, for the proxy round-trip,
// `make deploy bootstrap`). Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

const LOCALSTACK = process.env.LOCALSTACK ?? 'http://localhost:4566';
const NANGO = process.env.NANGO_HOSTPORT ?? 'http://localhost:3003';
const SECRET = process.env.NANGO_SECRET_KEY ?? 'nango-demo-secret-key';

const STRIPE_EMU = 'http://stripe.localhost.localstack.cloud:4566';
const HUBSPOT_EMU = 'http://hubspot.localhost.localstack.cloud:4566';

function nangoProxy(providerConfigKey, baseUrl, path, extraHeaders = {}) {
  return fetch(`${NANGO}/proxy${path}`, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Provider-Config-Key': providerConfigKey,
      'Connection-Id': 'demo',
      'Base-Url-Override': baseUrl,
      ...extraHeaders,
    },
  });
}

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
  const email = `roundtrip-${Date.now()}@example.com`;

  const created = await fetch(`${STRIPE_EMU}/v1/customers`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer sk_test_emulator',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ email, name: 'Proxy Roundtrip' }),
  });
  assert.equal(created.ok, true, `emulator create failed: ${created.status}`);

  const res = await nangoProxy('stripe', STRIPE_EMU, '/v1/customers?limit=100');
  assert.equal(res.ok, true, `proxy read failed: ${res.status}`);

  const body = await res.json();
  const emails = (body.data ?? []).map((c) => c.email);
  assert.ok(
    emails.includes(email),
    `expected ${email} in proxy response, got ${JSON.stringify(emails)}`,
  );
});

test('a contact seeded in the HubSpot emulator is readable through the Nango proxy', async () => {
  const email = `roundtrip-${Date.now()}@example.com`;

  const created = await fetch(`${HUBSPOT_EMU}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer emulator-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { email, firstname: 'Proxy', lastname: 'Roundtrip' } }),
  });
  assert.equal(created.ok, true, `emulator create failed: ${created.status}`);

  const res = await nangoProxy(
    'hubspot',
    HUBSPOT_EMU,
    '/crm/v3/objects/contacts?properties=email&limit=100',
  );
  assert.equal(res.ok, true, `proxy read failed: ${res.status}`);

  const body = await res.json();
  const emails = (body.results ?? []).map((c) => c.properties?.email);
  assert.ok(
    emails.includes(email),
    `expected ${email} in proxy response, got ${JSON.stringify(emails)}`,
  );
});
