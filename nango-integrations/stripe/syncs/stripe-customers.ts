import { createSync } from 'nango';
import * as z from 'zod';

// The Nango proxy is pointed at the LocalStack Stripe emulator instead of
// api.stripe.com. On the compose network this host resolves to the LocalStack
// container; the emulator routes on the `stripe.` subdomain.
const EMULATOR_BASE_URL = 'http://stripe.localhost.localstack.cloud:4566';

const stripeCustomer = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string()
});

type StripeCustomer = z.infer<typeof stripeCustomer>;

const sync = createSync({
    description: 'Sync customers from the (emulated) Stripe API into Nango',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/stripe/customers', group: 'Customers' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        StripeCustomer: stripeCustomer
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/v1/customers',
            baseUrlOverride: EMULATOR_BASE_URL,
            params: { limit: 100 }
        });

        const rows = (response.data?.data ?? []) as any[];
        const customers: StripeCustomer[] = rows.map((c: any) => ({
            id: String(c.id),
            email: c.email ?? '',
            name: c.name ?? ''
        }));

        if (customers.length > 0) {
            await nango.batchSave(customers, 'StripeCustomer');
            await nango.log(`Saved ${customers.length} Stripe customers`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
