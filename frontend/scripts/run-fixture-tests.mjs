import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const testModule = await server.ssrLoadModule('/src/lib/fixtures/pi-phone-fixture-tests.ts');
  if (typeof testModule.run !== 'function') {
    throw new TypeError('Fixture test module must export run().');
  }
  await testModule.run();
  console.log('Pi Phone Svelte fixture adapter tests passed.');
} finally {
  await server.close();
}
