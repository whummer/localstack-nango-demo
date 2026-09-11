import { createAction } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack Resend twin instead of api.resend.com.
const EMULATOR_BASE_URL = 'http://resend.localhost.localstack.cloud:4566';

const input = z.object({
    to: z.string(),
    subject: z.string(),
    text: z.string()
});

const output = z.object({
    id: z.string()
});

const action = createAction({
    description: 'Send an email through the (emulated) Resend API',
    version: '1.0.0',
    endpoint: { method: 'POST', path: '/resend/emails', group: 'Emails' },
    input,
    output,

    exec: async (nango, input) => {
        const response = await nango.post({
            endpoint: '/emails',
            baseUrlOverride: EMULATOR_BASE_URL,
            data: {
                from: 'demo@localstack-nango-demo.dev',
                to: input.to,
                subject: input.subject,
                text: input.text
            }
        });

        return { id: String(response.data?.id ?? '') };
    }
});

export type NangoActionLocal = Parameters<(typeof action)['exec']>[0];
export default action;
