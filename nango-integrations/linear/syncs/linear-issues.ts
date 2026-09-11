import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack Linear emulator instead of api.linear.app.
const EMULATOR_BASE_URL = 'http://linear.localhost.localstack.cloud:4566';

const linearIssue = z.object({
    id: z.string(),
    title: z.string(),
    state: z.string()
});

type LinearIssue = z.infer<typeof linearIssue>;

const sync = createSync({
    description: 'Sync issues from the (emulated) Linear API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/linear/issues', group: 'Issues' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        LinearIssue: linearIssue
    },

    // Linear's API is GraphQL: a single POST /graphql endpoint for both
    // reads and writes, unlike the REST emulators.
    exec: async (nango) => {
        const response = await nango.post({
            endpoint: '/graphql',
            baseUrlOverride: EMULATOR_BASE_URL,
            data: {
                query: `query { issues(first: 50) { nodes { id title state { name } } } }`
            }
        });

        const rows = (response.data?.data?.issues?.nodes ?? []) as any[];
        const issues: LinearIssue[] = rows.map((i: any) => ({
            id: String(i.id),
            title: i.title ?? '',
            state: i.state?.name ?? ''
        }));

        if (issues.length > 0) {
            await nango.batchSave(issues, 'LinearIssue');
            await nango.log(`Saved ${issues.length} Linear issues`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
