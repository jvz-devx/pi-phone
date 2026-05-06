import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readRepoFile(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

function assertOrdered(source, labels) {
  let previousIndex = -1;
  for (const [label, needle] of labels) {
    const index = source.indexOf(needle, previousIndex + 1);
    assert.notEqual(index, -1, `Expected ${label} marker in PhoneServerRuntime after the previous marker.`);
    assert.ok(index > previousIndex, `Expected ${label} to appear after the previous static fallback marker.`);
    previousIndex = index;
  }
}

async function collectFileExtensions(directory) {
  const extensions = new Set();

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const path = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        extensions.add(extname(entry.name));
      }
    }));
  }

  await visit(directory);
  return extensions;
}

const runtime = await readRepoFile('src/extension/phone-server-runtime.ts');
const staticModule = await readRepoFile('src/extension/phone-static.ts');
const themeModule = await readRepoFile('src/extension/phone-theme.ts');
const svelteConfig = await readRepoFile('frontend/svelte.config.js');

assert.match(svelteConfig, /adapter-static/, 'SvelteKit must keep using adapter-static for Pi Phone static hosting.');
assert.match(svelteConfig, /pages:\s*['"]build['"]/, 'SvelteKit pages output should be frontend/build.');
assert.match(svelteConfig, /assets:\s*['"]build['"]/, 'SvelteKit assets output should be frontend/build.');
assert.match(svelteConfig, /fallback:\s*['"]index\.html['"]/, 'SvelteKit adapter fallback should be index.html for SPA routes.');

assertOrdered(runtime, [
  ['control stop route', 'if (url.pathname === phoneControlStopPath)'],
  ['health API route', 'if (url.pathname === "/api/health")'],
  ['quota API route', 'if (url.pathname === "/api/quota")'],
  ['unknown API guard', 'url.pathname.startsWith("/api/")'],
  ['static method guard', 'if (req.method !== "GET" && req.method !== "HEAD")'],
  ['static path sanitation', 'sanitizePublicPath(pathname)'],
  ['SPA index fallback', 'publicFilePath("index.html")'],
]);

assert.match(runtime, /this\.server\.on\("upgrade"/, 'WebSocket handling must stay on the HTTP upgrade path.');
assert.match(runtime, /url\.pathname !== "\/ws"/, 'Only /ws should be accepted for WebSocket upgrades.');
assert.match(runtime, /activeWss\.handleUpgrade\(req, socket, head/, 'Accepted /ws upgrades should be delegated to ws.handleUpgrade.');
assert.match(runtime, /buildThemePayload\(this\.latestCtx\?\.ui\?\.theme\)/, 'Status health responses must tolerate contexts without a ui theme object.');
assert.match(themeModule, /function themeColorToCss[\s\S]*try \{[\s\S]*theme\.getFgAnsi[\s\S]*catch \{[\s\S]*return "";/, 'Theme payload extraction must tolerate Pi themes without every requested color token.');
assert.match(runtime, /if \(!res\.headersSent\) \{\s*res\.writeHead\(500,/s, 'HTTP error handling must not send duplicate response headers.');

const healthRouteIndex = runtime.indexOf('if (url.pathname === "/api/health")');
assert.notEqual(healthRouteIndex, -1, 'Expected health API route in PhoneServerRuntime.');
const healthRouteEndIndex = runtime.indexOf('if (url.pathname === "/api/quota")', healthRouteIndex);
const healthRouteSource = runtime.slice(healthRouteIndex, healthRouteEndIndex);
const healthPayloadIndex = healthRouteSource.indexOf('const payload = authorized');
const healthWriteHeadIndex = healthRouteSource.indexOf('res.writeHead(200');
assert.ok(healthPayloadIndex !== -1 && healthWriteHeadIndex !== -1 && healthPayloadIndex < healthWriteHeadIndex, 'Health status payload should be built before response headers are sent.');

const requiredExtensions = new Set([
  '.css',
  '.html',
  '.ico',
  '.js',
  '.json',
  '.png',
  '.svg',
  '.txt',
  '.webmanifest',
  '.woff',
  '.woff2',
  '.ttf',
]);
const buildDirectory = join(repoRoot, 'frontend/build');
if (existsSync(buildDirectory)) {
  for (const extension of await collectFileExtensions(buildDirectory)) {
    if (extension) requiredExtensions.add(extension);
  }
}

for (const extension of requiredExtensions) {
  assert.match(staticModule, new RegExp(`${extension.replace('.', '\\.')}":\\s*"`), `Missing MIME type for ${extension}.`);
}

console.log('Phone static fallback checks passed.');
