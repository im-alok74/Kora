import { startMockGsp } from '@kora/adapters';

// A stand-in for the GST partner. Development, tests and demos only: nothing here reaches the real portal.
const port = Number(process.env.PORT ?? 3202);
const gsp = await startMockGsp(port, { token: process.env.GSP_TOKEN });
console.log(JSON.stringify({ event: 'mock-gsp started', url: gsp.url }));
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, async () => { await gsp.close(); process.exit(0); });
