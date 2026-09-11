import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack GitHub emulator instead of api.github.com.
const EMULATOR_BASE_URL = 'http://github.localhost.localstack.cloud:4566';

const githubRepo = z.object({
    id: z.string(),
    name: z.string(),
    fullName: z.string(),
    private: z.boolean()
});

type GithubRepo = z.infer<typeof githubRepo>;

const sync = createSync({
    description: 'Sync repositories from the (emulated) GitHub API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/github/repos', group: 'Repositories' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        GithubRepo: githubRepo
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/user/repos',
            baseUrlOverride: EMULATOR_BASE_URL,
            params: { per_page: 100 }
        });

        const rows = (Array.isArray(response.data) ? response.data : []) as any[];
        const repos: GithubRepo[] = rows.map((r: any) => ({
            id: String(r.id),
            name: r.name ?? '',
            fullName: r.full_name ?? '',
            private: Boolean(r.private)
        }));

        if (repos.length > 0) {
            await nango.batchSave(repos, 'GithubRepo');
            await nango.log(`Saved ${repos.length} GitHub repos`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
