import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readRepoFile(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`);
}

function assertNotIncludes(source, needle, message) {
  assert.ok(!source.includes(needle), message || `Expected source not to include ${needle}`);
}

function assertOrdered(source, labels) {
  let previousIndex = -1;
  for (const [label, needle] of labels) {
    const index = source.indexOf(needle, previousIndex + 1);
    assert.notEqual(index, -1, `Expected ${label} after the previous guardrail marker.`);
    assert.ok(index > previousIndex, `Expected ${label} to appear after the previous guardrail marker.`);
    previousIndex = index;
  }
}

function assertNoMissingIndexAssets(indexHtml, buildDir) {
  const assetMatches = [...indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const assetPath of assetMatches) {
    if (!assetPath.startsWith('/')) continue;
    if (assetPath.startsWith('/api/') || assetPath === '/ws') continue;
    if (assetPath.includes('://') || assetPath.startsWith('data:')) continue;
    const diskPath = join(buildDir, decodeURIComponent(assetPath.replace(/^\/+/, '')));
    assert.ok(existsSync(diskPath), `Built index.html references missing static asset ${assetPath}.`);
  }
}

const rootPackage = JSON.parse(await readRepoFile('package.json'));
const releaseScript = await readRepoFile('scripts/release-sveltekit-public.mjs');
const appShell = await readRepoFile('frontend/src/lib/components/app/AppShell.svelte');
const inspectorPanel = await readRepoFile('frontend/src/lib/components/app/InspectorPanel.svelte');
const chatWorkspace = await readRepoFile('frontend/src/lib/components/chat/ChatWorkspace.svelte');
const composerMeta = await readRepoFile('frontend/src/lib/components/chat/ComposerMeta.svelte');
const quotaContext = await readRepoFile('frontend/src/lib/adapters/quota-context.ts');
const transport = await readRepoFile('frontend/src/lib/pi-phone-transport.ts');
const layoutCss = await readRepoFile('frontend/src/routes/layout.css');
const appHtml = await readRepoFile('frontend/src/app.html');
const manifestText = await readRepoFile('frontend/static/manifest.webmanifest');
const serviceWorker = await readRepoFile('frontend/static/sw.js');
const runtime = await readRepoFile('src/extension/phone-server-runtime.ts');

assertIncludes(appHtml, '<link rel="manifest" href="%sveltekit.assets%/manifest.webmanifest"', 'Svelte app must link the PWA manifest.');

assert.equal(rootPackage.scripts['frontend:sync-public:dry-run'], 'node scripts/release-sveltekit-public.mjs --dry-run', 'Dry-run cutover command must stay explicit.');
assert.equal(rootPackage.scripts['frontend:sync-public'], 'node scripts/release-sveltekit-public.mjs --confirm', 'Public cutover command must require explicit confirmation.');
for (const scriptName of ['test', 'frontend:build', 'frontend:check', 'frontend:test:fixtures']) {
  assertNotIncludes(rootPackage.scripts[scriptName] || '', 'frontend:sync-public', `${scriptName} must not run the public cutover command.`);
  assertNotIncludes(rootPackage.scripts[scriptName] || '', 'release-sveltekit-public', `${scriptName} must not invoke the release copy helper.`);
}
assertIncludes(releaseScript, "run('npm', ['run', 'static:fallback:check'])", 'Release dry-run/cutover must verify static fallback guardrails.');
assertIncludes(releaseScript, "run('npm', ['run', 'svelte:validation:check'])", 'Release dry-run/cutover must verify PWA/static validation guardrails.');
assertOrdered(releaseScript, [
  ['explicit mode guard', 'ensureExplicitMode();'],
  ['public clean guard', 'ensurePublicClean();'],
  ['frontend build', "run('npm', ['run', 'frontend:build']);"],
  ['build output check', 'ensureBuildOutput();'],
  ['static fallback validation', 'validateStaticFallbackContract();'],
  ['dry-run exit', 'if (dryRun) {'],
  ['confirmed public copy', 'copyPublicWithBackup();'],
]);

assertIncludes(quotaContext, 'supportsPiQuotaForModel', 'Quota support helper must remain centralized for tests and UI.');
assertIncludes(quotaContext, "provider === 'openai-codex'", 'Quota must be limited to the Pi openai-codex provider.');
assertIncludes(quotaContext, '/^gpt-/i', 'Quota must be limited to GPT-family model ids.');
assertIncludes(quotaContext, 'const primary = quotaSupported ? input.quota?.primaryWindow || null : null', 'Unsupported models must hide stale primary quota windows.');
assertIncludes(composerMeta, 'quotaContextDisplay', 'Composer metadata must use the quota/context display adapter.');
assertIncludes(transport, 'supportsPiQuotaForModel', 'Transport quota refresh must share the same supported-model guard as the UI.');
assertIncludes(transport, "makeApiUrl('/api/quota'", 'Supported quota refresh must use the existing Pi /api/quota route.');

assertIncludes(layoutCss, 'env(safe-area-inset-top)', 'Mobile layout must account for top safe-area inset.');
assertIncludes(layoutCss, 'env(safe-area-inset-bottom)', 'Mobile layout must account for bottom safe-area inset.');
assertIncludes(layoutCss, '--pi-visual-viewport-height', 'Layout must expose a visual viewport height CSS variable.');
assertIncludes(layoutCss, '--pi-keyboard-inset', 'Layout must expose keyboard inset spacing for the composer and sheets.');
assertIncludes(layoutCss, '.phone-mobile-sheet', 'Mobile sheets must have dedicated safe-area/keyboard CSS.');
assertIncludes(layoutCss, '@media (max-width: 767px)', 'Mobile breakpoint tuning must remain present.');
assertIncludes(layoutCss, '@media (pointer: coarse)', 'Touch target tuning must remain present.');

assertIncludes(appShell, "window.matchMedia('(min-width: 1024px)')", 'Desktop split workspace breakpoint must remain explicit.');
assertIncludes(appShell, 'grid-template-columns={desktopColumns}', 'Desktop shell must keep split workspace column state.');
assertIncludes(appShell, 'pi-phone-shell-left-open', 'Desktop session rail collapse preference must persist.');
assertIncludes(appShell, 'pi-phone-shell-right-open', 'Desktop inspector collapse preference must persist.');
assertIncludes(appShell, 'window.visualViewport?.addEventListener', 'Mobile keyboard/viewport handling must listen to visualViewport.');
assertIncludes(appShell, 'phone-mobile-sheet', 'Mobile panels must render as a bottom sheet.');
assertIncludes(appShell, 'handleMobilePanelKeydown', 'Mobile sheets must keep keyboard escape/focus handling.');
assertIncludes(appShell, "aria-label=\"Inspector panel\"", 'Desktop inspector panel must keep an accessible landmark.');
assertIncludes(inspectorPanel, 'QuickActionsPanel', 'Inspector usefulness depends on quick actions remaining available.');

assertIncludes(chatWorkspace, 'NEAR_BOTTOM_THRESHOLD = 120', 'Scroll follow-latest threshold must match the current design.');
assertIncludes(chatWorkspace, 'STREAM_FOLLOW_INTERVAL_MS = 320', 'Streaming auto-follow throttle must remain present.');
assertIncludes(chatWorkspace, 'stateStore.setFollowLatest(true)', 'Jump-to-latest must restore follow-latest state.');
assertIncludes(chatWorkspace, 'aria-label="Jump to latest message"', 'Jump-to-latest control must remain accessible.');
assertIncludes(chatWorkspace, 'style:padding-bottom={bottomPadding}', 'Conversation must reserve safe-area/composer bottom space.');

const manifest = JSON.parse(manifestText);
assert.equal(manifest.start_url, '/', 'PWA manifest start_url must load through the Pi static root.');
assert.equal(manifest.display, 'standalone', 'PWA manifest should stay installable as a standalone app.');
assert.ok(manifest.icons?.some((icon) => icon.src === '/icon.svg'), 'PWA manifest must reference the static icon.');

assertIncludes(serviceWorker, 'CACHE = "pi-phone-svelte-', 'Svelte service worker cache must use a Svelte-specific version.');
assertIncludes(serviceWorker, 'url.pathname.startsWith("/api/") || url.pathname === "/ws"', 'Service worker must never intercept Pi API or WebSocket routes.');
assertIncludes(serviceWorker, 'deleteTokenizedCacheEntries', 'Service worker must purge tokenized cache entries.');
assertIncludes(serviceWorker, 'Response.redirect', 'Service worker must keep token query redirect behavior for navigations.');
assertNotIncludes(serviceWorker, '"/app.js"', 'Svelte service worker must not precache legacy public/app.js.');
assertNotIncludes(serviceWorker, '"/styles.css"', 'Svelte service worker must not precache legacy public/styles.css.');
assertNotIncludes(serviceWorker, '"/app/', 'Svelte service worker must not precache legacy public/app modules.');

assertIncludes(runtime, 'if (url.pathname === "/api/quota")', 'PhoneServerRuntime must keep /api/quota before static fallback.');
assertIncludes(runtime, 'if (url.pathname.startsWith("/api/"))', 'PhoneServerRuntime must keep unknown /api/* out of SPA fallback.');
assertIncludes(runtime, 'publicFilePath("index.html")', 'PhoneServerRuntime must keep SPA index fallback for static routes.');
assertIncludes(runtime, 'url.pathname !== "/ws"', 'PhoneServerRuntime must keep WebSocket upgrades scoped to /ws.');

const buildDir = join(repoRoot, 'frontend/build');
if (existsSync(buildDir)) {
  const builtIndex = await readFile(join(buildDir, 'index.html'), 'utf8');
  const builtManifest = await readFile(join(buildDir, 'manifest.webmanifest'), 'utf8');
  const builtServiceWorker = await readFile(join(buildDir, 'sw.js'), 'utf8');
  assertIncludes(builtIndex, '/_app/immutable/entry/start', 'Built SvelteKit index must reference immutable app entry assets.');
  assertIncludes(builtIndex, '/manifest.webmanifest', 'Built SvelteKit index must link the manifest.');
  assertNoMissingIndexAssets(builtIndex, buildDir);
  assert.deepEqual(JSON.parse(builtManifest), manifest, 'Built manifest must match frontend/static/manifest.webmanifest.');
  assert.equal(builtServiceWorker, serviceWorker, 'Built service worker must match frontend/static/sw.js.');
}

console.log('Svelte validation coverage static checks passed.');
