import { createAction } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack logo.dev emulator instead of img.logo.dev.
// Uses Nango's "unauthenticated" provider type (no OAuth/API key managed by
// Nango) since this demo doesn't have a real logo.dev account - but the
// emulator itself still rejects calls with no credential at all, the same
// way the real API does. Any non-empty value works against the emulator.
const EMULATOR_BASE_URL = 'http://logodev.localhost.localstack.cloud:4566';

const input = z.object({
    domain: z.string()
});

const output = z.object({
    found: z.boolean(),
    contentType: z.string()
});

const action = createAction({
    description: 'Fetch a company logo through the (emulated) logo.dev API',
    version: '1.0.0',
    endpoint: { method: 'GET', path: '/logodev/logo', group: 'Logos' },
    input,
    output,

    exec: async (nango, input) => {
        const response = await nango.get({
            endpoint: `/${input.domain}`,
            baseUrlOverride: EMULATOR_BASE_URL,
            headers: { Authorization: 'Bearer pk_emulator_0000000000000000000' }
        });

        return {
            found: response.status === 200,
            contentType: String(response.headers?.['content-type'] ?? '')
        };
    }
});

export type NangoActionLocal = Parameters<(typeof action)['exec']>[0];
export default action;
