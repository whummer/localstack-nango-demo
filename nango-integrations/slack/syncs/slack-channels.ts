import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack Slack twin instead of slack.com/api.
const EMULATOR_BASE_URL = 'http://slack.localhost.localstack.cloud:4566';

const slackChannel = z.object({
    id: z.string(),
    name: z.string()
});

type SlackChannel = z.infer<typeof slackChannel>;

const sync = createSync({
    description: 'Sync channels from the (emulated) Slack API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/slack/channels', group: 'Channels' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        SlackChannel: slackChannel
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: '/api/conversations.list',
            baseUrlOverride: EMULATOR_BASE_URL
        });

        const rows = (response.data?.channels ?? []) as any[];
        const channels: SlackChannel[] = rows.map((c: any) => ({
            id: String(c.id),
            name: c.name ?? ''
        }));

        if (channels.length > 0) {
            await nango.batchSave(channels, 'SlackChannel');
            await nango.log(`Saved ${channels.length} Slack channels`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
