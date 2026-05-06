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
const parentWorker = await readRepoFile('src/session-pool/parent-session-worker.ts');
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
  ['static path sanitation', 'sanitizeStaticPath(pathname)'],
  ['SPA index fallback', 'staticIndexFilePath()'],
]);

assert.match(staticModule, /svelteBuildDir\s*=\s*resolve\(__dirname, "\.\.\/\.\.\/frontend\/build"\)/, 'SvelteKit build output must be the primary static root.');
assert.match(staticModule, /legacyPublicDir\s*=\s*resolve\(__dirname, "\.\.\/\.\.\/public"\)/, 'Deprecated public/ must remain available as a legacy fallback root.');
assert.match(staticModule, /function isSvelteBuildAvailable[\s\S]*index\.html[\s\S]*_app/, 'Svelte-first serving should require a valid frontend/build output.');
assert.match(staticModule, /function activeStaticSource[\s\S]*isSvelteBuildAvailable\(\)[\s\S]*"svelte-build"[\s\S]*"legacy-public"/, 'Svelte build must be preferred over deprecated public/ when available.');
assert.match(staticModule, /function sanitizeStaticPath[\s\S]*safeStaticPath\(activeStaticDir\(\), pathname\)/, 'Static path sanitation must resolve against the active Svelte-first static root.');
assert.match(staticModule, /function safeStaticPath[\s\S]*normalize\(pathname\)[\s\S]*resolve\(root[\s\S]*isInsideRoot/, 'Static path sanitation must keep traversal checks for every active root.');
assert.doesNotMatch(runtime, /publicFilePath\("index\.html"\)/, 'Runtime SPA fallback should use the active Svelte-first static index, not public/ directly.');
assert.match(runtime, /this\.server\.on\("upgrade"/, 'WebSocket handling must stay on the HTTP upgrade path.');
assert.match(runtime, /url\.pathname !== "\/ws"/, 'Only /ws should be accepted for WebSocket upgrades.');
assert.match(runtime, /activeWss\.handleUpgrade\(req, socket, head/, 'Accepted /ws upgrades should be delegated to ws.handleUpgrade.');
assert.match(runtime, /buildThemePayload\(this\.latestCtx\?\.ui\?\.theme\)/, 'Status health responses must tolerate contexts without a ui theme object.');
assert.match(themeModule, /function themeColorToCss[\s\S]*try \{[\s\S]*theme\.getFgAnsi[\s\S]*catch \{[\s\S]*return "";/, 'Theme payload extraction must tolerate Pi themes without every requested color token.');
assert.match(runtime, /async recaptureParentCommandContext\(ctx: ExtensionCommandContext\)[\s\S]*this\.captureCtx\(ctx\)[\s\S]*await this\.parentWorker\.captureContext\(ctx, \{ emitSnapshot: true, emitCatalog: true \}\)[\s\S]*this\.sessionPool\?\.broadcastCatalog\(\)[\s\S]*this\.broadcastStatus\(\)/, '/phone-status command-context recapture must refresh parent snapshot, catalog, and status.');
assert.match(runtime, /async handlePhoneStatus\(ctx: ExtensionCommandContext\) \{\s*await this\.recaptureParentCommandContext\(ctx\);/, '/phone-status must use explicit parent command-context recapture before reporting status.');
assert.match(runtime, /ensureParentCommandContextForRpc\(ws: WebSocket, worker: SessionController, command: string, id\?: unknown\)[\s\S]*worker\.kind !== "parent" \|\| this\.latestCommandCtx[\s\S]*sendRpcFailure/, 'Parent mutating RPC commands must fail before side effects when command context is unavailable.');
assert.match(runtime, /if \(command\.type === "phone_open_branch_path"\) \{[\s\S]*try \{[\s\S]*createBranchSessionFromEntryForWorker[\s\S]*\} catch \(error\)[\s\S]*sendRpcFailure\(ws, "phone_open_branch_path"/, 'Open path must preflight/report errors before branch switch side effects leak to the UI.');
assert.match(runtime, /const childCommand: Record<string, unknown> = \{[\s\S]*type: "prompt"[\s\S]*message: slashCommand\.text[\s\S]*source: slashCommand\.source[\s\S]*slashCommand\.path[\s\S]*slashCommand\.location[\s\S]*slashCommand\.sourceInfoPath/, 'Resolved remote slash command identity must be forwarded to parent/parallel workers.');
assert.match(parentWorker, /private async preparePromptText\(text: string, identity\?: SlashCommandIdentity \| null\)[\s\S]*this\.activeCommands\(\)\.filter\(\(entry: any\) => entry\?\.name === parsed\.name\)[\s\S]*this\.commandMatchesIdentity\(entry, identity\)[\s\S]*Ambiguous slash command/, 'Parent worker prompt preparation must use exact slash command identity and fail safely on ambiguity.');
assert.match(parentWorker, /private async submitPrompt\([\s\S]*identity\?: SlashCommandIdentity \| null[\s\S]*preparePromptText\(String\(message \|\| ""\), identity\)/, 'Parent worker submitPrompt must carry slash command identity into prompt expansion.');
assert.match(parentWorker, /source: command\.source[\s\S]*path: command\.path[\s\S]*location: command\.location[\s\S]*sourceInfoPath: command\.sourceInfoPath/, 'Parent worker request handling must pass prompt command identity fields into submitPrompt.');
assert.match(parentWorker, /captureContext\(ctx: ExtensionContext \| ExtensionCommandContext, options: \{ emitSnapshot\?: boolean; emitCatalog\?: boolean \} = \{\}\)[\s\S]*options\.emitCatalog[\s\S]*this\.options\.onStateChange\(\)/, 'Parent worker captureContext must honor emitCatalog so recaptured command contexts reach active sessions.');
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
