import type { NangoSync } from 'nango';
import type { StripeCustomer } from '../../models';

/**
 * Pulls Stripe customers via the Nango proxy. The proxy target is overridden to
 * the LocalStack Stripe emulator (see scripts/bootstrap.sh, which sets the
 * integration base URL, and demo.sh, which also sends Base-Url-Override).
 */
export default async function fetchData(nango: NangoSync): Promise<void> {
  let startingAfter: string | undefined;

  do {
    const res = await nango.get({
      endpoint: '/v1/customers',
      params: { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
    });

    const page = (res.data?.data ?? []) as Array<Record<string, any>>;
    const customers: StripeCustomer[] = page.map((c) => ({
      id: String(c.id),
      email: c.email ?? '',
      name: c.name ?? '',
    }));

    if (customers.length > 0) {
      await nango.batchSave(customers, 'StripeCustomer');
      startingAfter = customers[customers.length - 1].id;
    }

    if (!res.data?.has_more) break;
  } while (startingAfter);
}
