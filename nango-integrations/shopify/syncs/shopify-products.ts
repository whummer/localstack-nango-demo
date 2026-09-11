import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack Shopify emulator instead of
// <store>.myshopify.com.
const EMULATOR_BASE_URL = 'http://shopify.localhost.localstack.cloud:4566';

const shopifyProduct = z.object({
    id: z.string(),
    title: z.string(),
    vendor: z.string()
});

type ShopifyProduct = z.infer<typeof shopifyProduct>;

const sync = createSync({
    description: 'Sync products from the (emulated) Shopify Admin API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/shopify/products', group: 'Products' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        ShopifyProduct: shopifyProduct
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/admin/api/2024-01/products.json',
            baseUrlOverride: EMULATOR_BASE_URL
        });

        const rows = (response.data?.products ?? []) as any[];
        const products: ShopifyProduct[] = rows.map((p: any) => ({
            id: String(p.id),
            title: p.title ?? '',
            vendor: p.vendor ?? ''
        }));

        if (products.length > 0) {
            await nango.batchSave(products, 'ShopifyProduct');
            await nango.log(`Saved ${products.length} Shopify products`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
