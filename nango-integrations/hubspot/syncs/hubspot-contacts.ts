import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack HubSpot emulator instead of api.hubapi.com.
const EMULATOR_BASE_URL = 'http://hubspot.localhost.localstack.cloud:4566';

const hubspotContact = z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string()
});

type HubSpotContact = z.infer<typeof hubspotContact>;

const sync = createSync({
    description: 'Sync contacts from the (emulated) HubSpot CRM API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/hubspot/contacts', group: 'Contacts' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        HubSpotContact: hubspotContact
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/crm/v3/objects/contacts',
            baseUrlOverride: EMULATOR_BASE_URL,
            params: { limit: 100, properties: 'email,firstname,lastname' }
        });

        const rows = (response.data?.results ?? []) as any[];
        const contacts: HubSpotContact[] = rows.map((r: any) => ({
            id: String(r.id),
            email: r.properties?.email ?? '',
            firstName: r.properties?.firstname ?? '',
            lastName: r.properties?.lastname ?? ''
        }));

        if (contacts.length > 0) {
            await nango.batchSave(contacts, 'HubSpotContact');
            await nango.log(`Saved ${contacts.length} HubSpot contacts`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
