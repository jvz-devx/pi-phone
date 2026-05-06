import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "../..");
const packageJsonPath = resolve(packageRoot, "package.json");
const shortShaLength = 7;

type AnyCtx = ExtensionContext | ExtensionCommandContext;

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
};

type PackageJson = {
  name?: string;
  version?: string;
};

export type PhoneUpdateStatus = {
  packageRoot: string;
  packageName: string;
  version: string;
  settingsSources: string[];
  isGit: boolean;
  isManagedPiGitCheckout: boolean;
  remoteUrl: string;
  branch: string;
  upstream: string;
  remoteRef: string;
  localHead: string;
  remoteHead: string;
  dirty: boolean;
  relation: "unknown" | "up-to-date" | "behind" | "ahead" | "diverged";
  fetchError: string;
};

type UpdateMode = "fast-forward" | "reset";

function trim(value: string) {
  return value.trim();
}

function shortSha(value: string) {
  return value ? value.slice(0, shortShaLength) : "unknown";
}

function commandErrorMessage(result: CommandResult) {
  return trim(result.stderr || result.stdout) || `command exited with code ${result.code ?? "unknown"}`;
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return {
      ok: true,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
      code: 0,
    };
  } catch (error: any) {
    return {
      ok: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || ""),
      code: typeof error?.code === "number" ? error.code : null,
    };
  }
}

function runGit(args: string[], timeoutMs?: number) {
  return runCommand("git", args, packageRoot, timeoutMs);
}

async function readPackageJson(): Promise<PackageJson> {
  try {
    return JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

async function readJsonFile(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function sourceMatchesPiPhone(source: unknown) {
  if (typeof source !== "string") return false;
  return /(?:pi-phone|@malinamnam\/pi-phone)/i.test(source);
}

function collectSourcesFromSettings(settings: any) {
  const sources: string[] = [];
  for (const entry of Array.isArray(settings?.packages) ? settings.packages : []) {
    const source = typeof entry === "string" ? entry : entry?.source;
    if (sourceMatchesPiPhone(source)) sources.push(source);
  }
  return sources;
}

async function findSettingsSources(ctx?: AnyCtx) {
  const candidates = new Set<string>();
  const home = process.env.HOME;
  if (home) candidates.add(resolve(home, ".pi/agent/settings.json"));
  if (ctx?.cwd) candidates.add(resolve(ctx.cwd, ".pi/settings.json"));
  candidates.add(resolve(process.cwd(), ".pi/settings.json"));

  const sources = new Set<string>();
  for (const path of candidates) {
    const settings = await readJsonFile(path);
    for (const source of collectSourcesFromSettings(settings)) sources.add(source);
  }
  return [...sources];
}

function isPinnedSource(source: string) {
  if (/^npm:/i.test(source)) return /@[^/]+$/.test(source.replace(/^npm:/i, ""));

  const gitSource = source.replace(/^git:/i, "");
  const hashRefIndex = gitSource.indexOf("#");
  if (hashRefIndex >= 0 && hashRefIndex < gitSource.length - 1) return true;

  const lastAt = gitSource.lastIndexOf("@");
  const lastPathSeparator = Math.max(gitSource.lastIndexOf("/"), gitSource.lastIndexOf(":"));
  return lastAt > lastPathSeparator;
}

function pinnedSettingsSources(status: PhoneUpdateStatus) {
  return status.settingsSources.filter(isPinnedSource);
}

function managedPiGitCheckout(root: string) {
  const normalized = root.split(sep).join("/");
  return normalized.includes("/.pi/agent/git/") || normalized.includes("/.pi/git/");
}

async function gitOutput(args: string[], fallback = "") {
  const result = await runGit(args);
  return result.ok ? trim(result.stdout) : fallback;
}

async function isGitCheckout() {
  if (!existsSync(resolve(packageRoot, ".git"))) {
    const inside = await runGit(["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || trim(inside.stdout) !== "true") return false;
  }

  const topLevel = await gitOutput(["rev-parse", "--show-toplevel"]);
  return Boolean(topLevel) && resolve(topLevel) === packageRoot;
}

async function remoteRefExists(remoteRef: string) {
  if (!remoteRef) return false;
  const result = await runGit(["rev-parse", "--verify", `${remoteRef}^{commit}`]);
  return result.ok;
}

async function detectRemoteRef(branch: string, upstream: string) {
  if (upstream && await remoteRefExists(upstream)) return upstream;

  const originHead = await gitOutput(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead && await remoteRefExists(originHead)) return originHead;

  const branchRef = branch && branch !== "HEAD" ? `origin/${branch}` : "";
  if (branchRef && await remoteRefExists(branchRef)) return branchRef;

  for (const fallback of ["origin/master", "origin/main"]) {
    if (await remoteRefExists(fallback)) return fallback;
  }

  return "";
}

async function isAncestor(ancestor: string, descendant: string) {
  if (!ancestor || !descendant) return false;
  const result = await runGit(["merge-base", "--is-ancestor", ancestor, descendant]);
  return result.ok;
}

async function relationFor(localHead: string, remoteHead: string): Promise<PhoneUpdateStatus["relation"]> {
  if (!localHead || !remoteHead) return "unknown";
  if (localHead === remoteHead) return "up-to-date";
  const localBeforeRemote = await isAncestor(localHead, remoteHead);
  if (localBeforeRemote) return "behind";
  const remoteBeforeLocal = await isAncestor(remoteHead, localHead);
  return remoteBeforeLocal ? "ahead" : "diverged";
}

export async function getPhoneUpdateStatus(ctx?: AnyCtx, options: { fetch?: boolean; fetchTimeoutMs?: number } = {}): Promise<PhoneUpdateStatus> {
  const packageJson = await readPackageJson();
  const settingsSources = await findSettingsSources(ctx);
  const status: PhoneUpdateStatus = {
    packageRoot,
    packageName: packageJson.name || "pi-phone",
    version: packageJson.version || "unknown",
    settingsSources,
    isGit: false,
    isManagedPiGitCheckout: managedPiGitCheckout(packageRoot),
    remoteUrl: "",
    branch: "",
    upstream: "",
    remoteRef: "",
    localHead: "",
    remoteHead: "",
    dirty: false,
    relation: "unknown",
    fetchError: "",
  };

  status.isGit = await isGitCheckout();
  if (!status.isGit) return status;

  status.remoteUrl = await gitOutput(["remote", "get-url", "origin"]);
  status.branch = await gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], "HEAD");
  status.upstream = await gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);

  if (options.fetch) {
    const fetch = await runGit(["fetch", "--prune", "origin"], options.fetchTimeoutMs ?? 30_000);
    if (!fetch.ok) status.fetchError = commandErrorMessage(fetch);
  }

  status.remoteRef = await detectRemoteRef(status.branch, status.upstream);
  status.localHead = await gitOutput(["rev-parse", "HEAD"]);
  status.remoteHead = status.remoteRef ? await gitOutput(["rev-parse", `${status.remoteRef}^{commit}`]) : "";
  status.dirty = Boolean(await gitOutput(["status", "--porcelain"]));
  status.relation = await relationFor(status.localHead, status.remoteHead);
  return status;
}

function statusLabel(status: PhoneUpdateStatus) {
  if (!status.isGit) return "not a git checkout";
  if (status.fetchError) return `remote check failed: ${status.fetchError}`;
  if (!status.remoteHead) return "remote HEAD unknown";
  if (status.relation === "up-to-date") return status.dirty ? "up to date, but local checkout has uncommitted changes" : "up to date";
  if (status.relation === "behind") return status.dirty ? "update available, but local checkout has uncommitted changes" : "update available";
  if (status.relation === "ahead") return status.dirty ? "local checkout is ahead of remote and has uncommitted changes" : "local checkout is ahead of remote";
  if (status.relation === "diverged") return status.dirty ? "local and remote have diverged, and local checkout has uncommitted changes" : "local and remote have diverged";
  return status.dirty ? "unknown, and local checkout has uncommitted changes" : "unknown";
}

export function formatPhoneVersionStatus(status: PhoneUpdateStatus) {
  const lines = [
    "Pi Phone version",
    "",
    `Package: ${status.packageName} ${status.version}`,
    `Path: ${status.packageRoot}`,
    `Install: ${status.isGit ? "git checkout" : "non-git package or local path"}${status.isManagedPiGitCheckout ? " (Pi-managed git clone)" : ""}`,
  ];

  if (status.settingsSources.length) {
    lines.push(`Settings source: ${status.settingsSources.join(", ")}`);
    const pinnedSources = pinnedSettingsSources(status);
    if (pinnedSources.length) {
      lines.push("Pinned source note: refs like @master/@main/@v1 are skipped by `pi update --extensions`; use an unpinned git source for rolling updates.");
    }
  }

  if (status.isGit) {
    lines.push(
      `Remote: ${status.remoteUrl || "unknown"}`,
      `Branch: ${status.branch || "unknown"}`,
      `Local HEAD: ${shortSha(status.localHead)}${status.dirty ? " (dirty)" : ""}`,
      `Remote HEAD: ${status.remoteRef || "unknown"}${status.remoteHead ? ` @ ${shortSha(status.remoteHead)}` : ""}`,
      `Update available: ${status.relation === "behind" ? "yes" : "no"}`,
    );
  }

  lines.push(`Status: ${statusLabel(status)}`);
  return lines.join("\n");
}

export async function maybeNotifyPhoneUpdateAvailable(ctx: AnyCtx) {
  if (process.env.PI_PHONE_CHECK_UPDATES !== "1") return;
  const status = await getPhoneUpdateStatus(ctx, { fetch: true, fetchTimeoutMs: 10_000 });
  if (!status.isGit || status.fetchError || status.dirty || status.relation !== "behind") return;
  ctx.ui.notify(
    `Pi Phone update available: ${shortSha(status.localHead)} → ${shortSha(status.remoteHead)}. Run /phone-update to update, then /reload.`,
    "info",
  );
}

function updateSummary(status: PhoneUpdateStatus, mode: UpdateMode) {
  const action = mode === "fast-forward" ? "fast-forward" : "hard reset";
  return [
    `Update Pi Phone by ${action}?`,
    "",
    `Path: ${status.packageRoot}`,
    `Remote: ${status.remoteUrl || "origin"}`,
    `Target: ${status.remoteRef} @ ${shortSha(status.remoteHead)}`,
    `Current: ${shortSha(status.localHead)}`,
    mode === "reset" ? "This will reset the Pi-managed package clone to the remote commit. Uncommitted changes are refused before this prompt." : "This will only move the package clone forward.",
  ].join("\n");
}

async function runNpmInstall() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return runCommand(process.execPath, [npmExecPath, "install"], packageRoot, 120_000);
  }
  return runCommand("npm", ["install"], packageRoot, 120_000);
}

export async function handlePhoneUpdate(ctx: ExtensionCommandContext) {
  ctx.ui.notify("Checking Pi Phone git package for updates...", "info");
  const status = await getPhoneUpdateStatus(ctx, { fetch: true });

  if (!status.isGit) {
    ctx.ui.notify(`Pi Phone is not running from a git checkout.\n\n${formatPhoneVersionStatus(status)}`, "warning");
    return;
  }
  if (status.fetchError) {
    ctx.ui.notify(`Could not fetch Pi Phone updates: ${status.fetchError}`, "warning");
    return;
  }
  if (!status.remoteHead || !status.remoteRef) {
    ctx.ui.notify(`Could not determine the remote branch to update from.\n\n${formatPhoneVersionStatus(status)}`, "warning");
    return;
  }
  if (status.dirty) {
    ctx.ui.notify(`Refusing to update because the Pi Phone package checkout has uncommitted changes.\n\n${formatPhoneVersionStatus(status)}`, "warning");
    return;
  }

  const pinnedSources = pinnedSettingsSources(status);
  if (pinnedSources.length) {
    ctx.ui.notify(
      `Refusing to update because Pi Phone is installed from a pinned source:\n${pinnedSources.join("\n")}\n\nPinned refs are intentionally frozen and skipped by pi update. Install the unpinned source to receive rolling updates:\npi install git:https://github.com/jvz-devx/pi-phone`,
      "warning",
    );
    return;
  }

  if (status.relation === "up-to-date") {
    ctx.ui.notify(formatPhoneVersionStatus(status), "info");
    return;
  }
  if (status.relation === "ahead") {
    ctx.ui.notify(`Refusing to update because the local Pi Phone checkout is ahead of the remote; there is no remote update to apply.\n\n${formatPhoneVersionStatus(status)}`, "warning");
    return;
  }
  if (status.relation === "unknown") {
    ctx.ui.notify(`Refusing to update because the relationship between local and remote commits could not be determined.\n\n${formatPhoneVersionStatus(status)}`, "warning");
    return;
  }

  const mode: UpdateMode = status.relation === "behind" ? "fast-forward" : "reset";
  if (mode === "reset" && !status.isManagedPiGitCheckout) {
    ctx.ui.notify(
      `The checkout cannot fast-forward, and this does not look like a Pi-managed git clone. Refusing to reset it automatically.\n\n${formatPhoneVersionStatus(status)}`,
      "warning",
    );
    return;
  }

  const ok = await ctx.ui.confirm("Update Pi Phone?", updateSummary(status, mode));
  if (!ok) {
    ctx.ui.notify("Pi Phone update cancelled.", "info");
    return;
  }

  const update = mode === "fast-forward"
    ? await runGit(["merge", "--ff-only", status.remoteRef], 30_000)
    : await runGit(["reset", "--hard", status.remoteRef], 30_000);
  if (!update.ok) {
    ctx.ui.notify(`Pi Phone git update failed: ${commandErrorMessage(update)}`, "error");
    return;
  }

  ctx.ui.notify("Installing Pi Phone package dependencies...", "info");
  const install = await runNpmInstall();
  if (!install.ok) {
    ctx.ui.notify(`Pi Phone updated, but npm install failed: ${commandErrorMessage(install)}\n\nRun npm install manually in ${packageRoot}, then /reload.`, "error");
    return;
  }

  const nextStatus = await getPhoneUpdateStatus(ctx, { fetch: false });
  ctx.ui.notify(
    `Pi Phone updated successfully: ${shortSha(status.localHead)} → ${shortSha(nextStatus.localHead)}.\n\nRun /reload or restart Pi to load the updated extension code.`,
    "info",
  );
}
