#!/usr/bin/env bash
# Create sample records directly in the LocalStack application emulators, using
# each vendor's real API shape. Safe to run more than once.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

STRIPE=http://stripe.localhost.localstack.cloud:4566
XERO=http://xero.localhost.localstack.cloud:4566
HUBSPOT=http://hubspot.localhost.localstack.cloud:4566

log "Stripe: customers"
for row in "ada@example.com|Ada Lovelace" "grace@example.com|Grace Hopper"; do
  IFS='|' read -r email name <<<"$row"
  curl -sS -o /dev/null -X POST "${STRIPE}/v1/customers" \
    -H "Authorization: Bearer sk_test_emulator" \
    --data-urlencode "email=${email}" \
    --data-urlencode "name=${name}"
done

log "Xero: invoices"
curl -sS -o /dev/null -X POST "${XERO}/api.xro/2.0/Invoices" \
  -H "Authorization: Bearer emulator-token" \
  -H "Xero-Tenant-Id: demo-tenant" \
  -H "Content-Type: application/json" \
  -d '{
        "Invoices": [
          {
            "Type": "ACCREC",
            "InvoiceNumber": "INV-001",
            "Status": "AUTHORISED",
            "LineItems": [
              { "Description": "Consulting", "Quantity": 1, "UnitAmount": 1200 }
            ],
            "Total": 1200
          }
        ]
      }'

log "HubSpot: contacts"
for row in "ada@example.com|Ada|Lovelace" "grace@example.com|Grace|Hopper"; do
  IFS='|' read -r email first last <<<"$row"
  curl -sS -o /dev/null -X POST "${HUBSPOT}/crm/v3/objects/contacts" \
    -H "Authorization: Bearer emulator-token" \
    -H "Content-Type: application/json" \
    -d "{\"properties\":{\"email\":\"${email}\",\"firstname\":\"${first}\",\"lastname\":\"${last}\"}}"
done

log "seed complete"
