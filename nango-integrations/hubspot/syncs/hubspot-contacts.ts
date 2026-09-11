import type { NangoSync } from 'nango';
import type { HubSpotContact } from '../../models';

/**
 * Pulls HubSpot CRM contacts via the Nango proxy, targeting the LocalStack
 * HubSpot emulator.
 */
export default async function fetchData(nango: NangoSync): Promise<void> {
  let after: string | undefined;

  do {
    const res = await nango.get({
      endpoint: '/crm/v3/objects/contacts',
      params: {
        limit: 100,
        properties: 'email,firstname,lastname',
        ...(after ? { after } : {}),
      },
    });

    const rows = (res.data?.results ?? []) as Array<Record<string, any>>;
    const contacts: HubSpotContact[] = rows.map((r) => ({
      id: String(r.id),
      email: r.properties?.email ?? '',
      firstName: r.properties?.firstname ?? '',
      lastName: r.properties?.lastname ?? '',
    }));

    if (contacts.length > 0) {
      await nango.batchSave(contacts, 'HubSpotContact');
    }

    after = res.data?.paging?.next?.after;
  } while (after);
}
