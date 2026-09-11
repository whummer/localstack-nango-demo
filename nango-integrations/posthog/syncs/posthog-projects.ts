import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack PostHog emulator instead of app.posthog.com.
const EMULATOR_BASE_URL = 'http://posthog.localhost.localstack.cloud:4566';

const posthogProject = z.object({
    id: z.string(),
    name: z.string()
});

type PosthogProject = z.infer<typeof posthogProject>;

const sync = createSync({
    description: 'Sync projects from the (emulated) PostHog API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/posthog/projects', group: 'Projects' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        PosthogProject: posthogProject
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/api/projects/',
            baseUrlOverride: EMULATOR_BASE_URL
        });

        const rows = (response.data?.results ?? response.data ?? []) as any[];
        const projects: PosthogProject[] = (Array.isArray(rows) ? rows : []).map((p: any) => ({
            id: String(p.id),
            name: p.name ?? ''
        }));

        if (projects.length > 0) {
            await nango.batchSave(projects, 'PosthogProject');
            await nango.log(`Saved ${projects.length} PostHog projects`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
