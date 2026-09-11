import { createAction } from 'nango';
import * as z from 'zod';

// Nango proxy target: the LocalStack logo.dev emulator instead of img.logo.dev.
// logo.dev is a public, unauthenticated image API (no OAuth/API key needed
// for the demo), so this integration uses Nango's "unauthenticated" provider
// type rather than OAuth2 credentials.
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
            baseUrlOverride: EMULATOR_BASE_URL
        });

        return {
            found: response.status === 200,
            contentType: String(response.headers?.['content-type'] ?? '')
        };
    }
});

export type NangoActionLocal = Parameters<(typeof action)['exec']>[0];
export default action;
