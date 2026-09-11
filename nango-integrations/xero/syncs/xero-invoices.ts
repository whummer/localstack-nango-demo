import type { NangoSync } from 'nango';
import type { XeroInvoice } from '../../models';

/**
 * Pulls Xero invoices via the Nango proxy, targeting the LocalStack Xero
 * emulator. Xero requires a tenant id header, injected here for the demo.
 */
export default async function fetchData(nango: NangoSync): Promise<void> {
  const res = await nango.get({
    endpoint: '/api.xro/2.0/Invoices',
    headers: { 'Xero-Tenant-Id': 'demo-tenant' },
  });

  const rows = (res.data?.Invoices ?? []) as Array<Record<string, any>>;
  const invoices: XeroInvoice[] = rows.map((i) => ({
    id: String(i.InvoiceID ?? i.InvoiceNumber),
    number: i.InvoiceNumber ?? '',
    total: Number(i.Total ?? 0),
    status: i.Status ?? 'DRAFT',
  }));

  if (invoices.length > 0) {
    await nango.batchSave(invoices, 'XeroInvoice');
  }
}
