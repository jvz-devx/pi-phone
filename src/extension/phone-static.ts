import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve, sep } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const svelteBuildDir = resolve(__dirname, "../../frontend/build");
export const legacyPublicDir = resolve(__dirname, "../../public");
/** @deprecated Legacy static fallback. Prefer `activeStaticDir()` / `sanitizeStaticPath()`. */
export const publicDir = legacyPublicDir;

export type PhoneStaticSource = "svelte-build" | "legacy-public";

export const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isInsideRoot(filePath: string, root: string) {
  return filePath === root || filePath.startsWith(`${root}${sep}`);
}

function safeStaticPath(root: string, pathname: string): string | null {
  const normalized = normalize(pathname).replace(/^\/+/, "");
  const filePath = resolve(root, normalized === "" ? "index.html" : normalized);
  if (!isInsideRoot(filePath, root)) return null;
  return filePath;
}

export function isSvelteBuildAvailable(root = svelteBuildDir) {
  return existsSync(join(root, "index.html")) && existsSync(join(root, "_app"));
}

export function activeStaticSource(): PhoneStaticSource {
  return isSvelteBuildAvailable() ? "svelte-build" : "legacy-public";
}

export function activeStaticDir(): string {
  return activeStaticSource() === "svelte-build" ? svelteBuildDir : legacyPublicDir;
}

export function sanitizeStaticPath(pathname: string): string | null {
  return safeStaticPath(activeStaticDir(), pathname);
}

export function staticIndexFilePath(): string {
  return join(activeStaticDir(), "index.html");
}

/** @deprecated Legacy name retained for compatibility; resolves against the active Svelte-first static root. */
export function sanitizePublicPath(pathname: string): string | null {
  return sanitizeStaticPath(pathname);
}

/** @deprecated Legacy name retained for compatibility; resolves against deprecated `public/` only. */
export function publicFilePath(relativePath: string): string {
  return join(legacyPublicDir, relativePath);
}
