#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const frontendBuild = join(repoRoot, 'frontend', 'build');
const publicDir = join(repoRoot, 'public');
const backupRoot = join(repoRoot, '.pi-phone-public-backups');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const confirmed = args.has('--confirm');

function usage() {
  console.error(`Usage:
  npm run frontend:sync-public:dry-run  # build frontend and validate deprecated public fallback sync preconditions
  npm run frontend:sync-public          # build frontend, back up public/, replace deprecated public fallback with frontend/build

Direct usage:
  node scripts/release-sveltekit-public.mjs --dry-run
  node scripts/release-sveltekit-public.mjs --confirm`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    throw new Error(`${command} ${commandArgs.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout || '';
}

function ensureExplicitMode() {
  if (dryRun === confirmed) {
    usage();
    throw new Error('Choose exactly one release mode: --dry-run or --confirm.');
  }
}

function ensurePublicClean() {
  const status = run('git', ['status', '--short', '--', 'public'], { capture: true }).trim();
  if (status) {
    throw new Error(`Refusing to touch public/ because it is not clean in git status:\n${status}`);
  }
}

function ensureBuildOutput() {
  const requiredFiles = ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg'];
  for (const fileName of requiredFiles) {
    const filePath = join(frontendBuild, fileName);
    if (!existsSync(filePath)) {
      throw new Error(`Expected SvelteKit static output at ${filePath}`);
    }
  }

  const entries = readdirSync(frontendBuild);
  if (!entries.includes('_app')) {
    throw new Error('Expected frontend/build/_app from SvelteKit adapter-static output.');
  }
}

function validateStaticFallbackContract() {
  console.log('Validating static fallback, PWA, and /api/* + /ws guardrails...');
  run('npm', ['run', 'static:fallback:check']);
  run('npm', ['run', 'svelte:validation:check']);
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function copyPublicWithBackup() {
  if (!existsSync(publicDir) || !statSync(publicDir).isDirectory()) {
    throw new Error(`Expected existing public/ directory at ${publicDir}`);
  }

  mkdirSync(backupRoot, { recursive: true });
  const backupDir = join(backupRoot, `public-${timestamp()}`);
  cpSync(publicDir, backupDir, { recursive: true, dereference: false, force: false, errorOnExist: true });

  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  cpSync(frontendBuild, publicDir, { recursive: true, dereference: false, force: true });

  console.log(`Backed up previous public/ to ${backupDir}`);
  console.log('Copied frontend/build to public/. Review git diff before committing the release cutover.');
}

try {
  ensureExplicitMode();
  ensurePublicClean();

  console.log('Building SvelteKit frontend without writing to public/...');
  run('npm', ['run', 'frontend:build']);
  ensureBuildOutput();
  validateStaticFallbackContract();

  if (dryRun) {
    console.log('Dry run complete: public/ was not modified. Runtime serving uses frontend/build when present.');
    process.exit(0);
  }

  copyPublicWithBackup();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
