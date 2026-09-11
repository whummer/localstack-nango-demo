import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack Xero emulator instead of api.xero.com.
const EMULATOR_BASE_URL = 'http://xero.localhost.localstack.cloud:4566';

const xeroInvoice = z.object({
    id: z.string(),
    number: z.string(),
    total: z.number(),
    status: z.string()
});

type XeroInvoice = z.infer<typeof xeroInvoice>;

const sync = createSync({
    description: 'Sync invoices from the (emulated) Xero Accounting API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/xero/invoices', group: 'Invoices' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        XeroInvoice: xeroInvoice
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/api.xro/2.0/Invoices',
            baseUrlOverride: EMULATOR_BASE_URL,
            headers: { 'Xero-Tenant-Id': 'demo-tenant' }
        });

        const rows = (response.data?.Invoices ?? []) as any[];
        const invoices: XeroInvoice[] = rows.map((i: any) => ({
            id: String(i.InvoiceID ?? i.InvoiceNumber),
            number: i.InvoiceNumber ?? '',
            total: Number(i.Total ?? 0),
            status: i.Status ?? 'DRAFT'
        }));

        if (invoices.length > 0) {
            await nango.batchSave(invoices, 'XeroInvoice');
            await nango.log(`Saved ${invoices.length} Xero invoices`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
