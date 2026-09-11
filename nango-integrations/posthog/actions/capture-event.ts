import { createAction } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack PostHog emulator instead of app.posthog.com.
//
// The emulator simulates PostHog's event-capture and feature-flag surfaces
// (single/batch capture, /decide) - it does not implement a "list projects"
// endpoint, so this is a capture action rather than a sync of listable
// records. See https://github.com/WonderTwin-AI/registry for the emulator's
// documented scope.
const EMULATOR_BASE_URL = 'http://posthog.localhost.localstack.cloud:4566';

const input = z.object({
    distinctId: z.string(),
    event: z.string()
});

const output = z.object({
    status: z.number()
});

const action = createAction({
    description: 'Capture an event through the (emulated) PostHog API',
    version: '1.0.0',
    endpoint: { method: 'POST', path: '/posthog/capture', group: 'Events' },
    input,
    output,

    exec: async (nango, input) => {
        const response = await nango.post({
            endpoint: '/capture/',
            baseUrlOverride: EMULATOR_BASE_URL,
            data: {
                api_key: 'phx_emulator0000000000000000000',
                event: input.event,
                distinct_id: input.distinctId,
                properties: { source: 'localstack-nango-demo' }
            }
        });

        return { status: response.status };
    }
});

export type NangoActionLocal = Parameters<(typeof action)['exec']>[0];
export default action;
