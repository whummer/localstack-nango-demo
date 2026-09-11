import { createSync } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack Twilio emulator instead of api.twilio.com.
const EMULATOR_BASE_URL = 'http://twilio.localhost.localstack.cloud:4566';

// Twilio's REST API is scoped by Account SID in the URL path. This demo uses
// a fixed placeholder SID; scripts/seed-emulators.sh sends messages under it.
const DEMO_ACCOUNT_SID = 'AC00000000000000000000000000demo';

const twilioMessage = z.object({
    id: z.string(),
    sid: z.string(),
    to: z.string(),
    from: z.string(),
    body: z.string()
});

type TwilioMessage = z.infer<typeof twilioMessage>;

const sync = createSync({
    description: 'Sync SMS messages from the (emulated) Twilio API',
    version: '1.0.0',
    endpoints: [{ method: 'GET', path: '/twilio/messages', group: 'Messages' }],
    frequency: 'every hour',
    autoStart: true,
    syncType: 'full',

    metadata: z.void(),
    models: {
        TwilioMessage: twilioMessage
    },

    exec: async (nango) => {
        const response = await nango.get({
            endpoint: `/2010-04-01/Accounts/${DEMO_ACCOUNT_SID}/Messages.json`,
            baseUrlOverride: EMULATOR_BASE_URL
        });

        const rows = (response.data?.messages ?? []) as any[];
        const messages: TwilioMessage[] = rows.map((m: any) => ({
            id: String(m.sid),
            sid: String(m.sid),
            to: m.to ?? '',
            from: m.from ?? '',
            body: m.body ?? ''
        }));

        if (messages.length > 0) {
            await nango.batchSave(messages, 'TwilioMessage');
            await nango.log(`Saved ${messages.length} Twilio messages`);
        }
    }
});

export type NangoSyncLocal = Parameters<(typeof sync)['exec']>[0];
export default sync;
