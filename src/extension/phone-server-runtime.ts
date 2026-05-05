import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  InputEventResult,
} from "@mariozechner/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import type { RawData, WebSocket, WebSocketServer } from "ws";
import { PhoneParentSessionWorker } from "../session-pool/parent-session-worker";
import { PhoneSessionPool } from "../session-pool/session-pool";
import { PhoneSessionWorker } from "../session-pool/session-worker";
import type { SessionController } from "../session-pool/types";
import { parsePhoneStartArgs } from "./phone-args";
import { listPhonePathSuggestions, resolvePhoneCdTargetPath } from "./phone-paths";
import { getQuotaForModel } from "./phone-quota";
import {
  isLoopbackAddress,
  phoneControlStopPath,
  readPersistedRuntimeState,
  removePersistedRuntimeState,
  stopPersistedRuntime,
  writePersistedRuntimeState,
} from "./phone-runtime";
import {
  createBranchSessionFromEntry,
  getTreeStateFromSessionFile,
  listSessionsForCwd,
} from "./phone-sessions";
import { mimeTypes, publicFilePath, sanitizePublicPath } from "./phone-static";
import { disableMatchingTailscaleServe, enableTailscaleServe, getTailscaleServeInfo } from "./phone-tailscale";
import { buildThemePayload } from "./phone-theme";
import type { PhoneConfig } from "./types";

type AnyCtx = ExtensionContext | ExtensionCommandContext;
type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";
type SessionShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";

type SlashCommandMatch = {
  text: string;
  name: string;
  source: string;
};

const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 60_000;

type WsModule = typeof import("ws");

const extensionRequire = createRequire(import.meta.url);
let cachedWsModule: WsModule | null = null;

function normalizeWsModule(moduleValue: unknown): WsModule | null {
  const candidate = moduleValue as Partial<WsModule> & { default?: Partial<WsModule> };
  const moduleWithServer = candidate.WebSocketServer ? candidate : candidate.default;
  return moduleWithServer?.WebSocketServer ? (moduleWithServer as WsModule) : null;
}

function addRequireForPath(requires: NodeRequire[], candidatePath: string | undefined) {
  if (!candidatePath) return;

  const add = (path: string) => {
    try {
      const resolvedPath = resolve(path);
      if (!existsSync(resolvedPath)) return;
      const stats = statSync(resolvedPath);
      requires.push(createRequire(stats.isDirectory() ? join(resolvedPath, "package.json") : resolvedPath));
    } catch {
      // Ignore invalid or inaccessible paths. They are only best-effort fallback roots.
    }
  };

  add(candidatePath);
  try {
    add(realpathSync(candidatePath));
  } catch {
    // Symlink resolution is best-effort.
  }
}

function buildWsFallbackRequires() {
  const requires: NodeRequire[] = [extensionRequire];
  addRequireForPath(requires, process.argv[1]);
  addRequireForPath(requires, process.env._);
  addRequireForPath(requires, process.cwd());

  for (const nodePath of (process.env.NODE_PATH || "").split(delimiter)) {
    addRequireForPath(requires, nodePath);
  }

  const nodePrefix = dirname(dirname(process.execPath));
  const piPackageSubpath = join("lib", "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
  for (const prefix of [process.env.npm_config_prefix, nodePrefix, join(process.env.HOME || "", ".npm-global"), "/usr/local", "/usr"]) {
    addRequireForPath(requires, prefix && join(prefix, piPackageSubpath));
  }

  for (const req of [...requires]) {
    try {
      const piPackageJson = req.resolve("@mariozechner/pi-coding-agent/package.json");
      addRequireForPath(requires, piPackageJson);
      addRequireForPath(requires, dirname(piPackageJson));
    } catch {
      // Pi may not be resolvable from every root when this extension is git-installed.
    }
  }

  return requires;
}

function tryRequireWs(req: NodeRequire) {
  try {
    return normalizeWsModule(req("ws"));
  } catch {
    // Try explicit resolution below so a require rooted at Pi can still locate its bundled ws.
  }

  try {
    const resolvedWs = req.resolve("ws");
    return normalizeWsModule(req(resolvedWs));
  } catch {
    return null;
  }
}

async function loadWsModule() {
  if (cachedWsModule) return cachedWsModule;

  let importError: unknown;
  try {
    const moduleValue = await import("ws");
    const wsModule = normalizeWsModule(moduleValue);
    if (wsModule) {
      cachedWsModule = wsModule;
      return wsModule;
    }
  } catch (error) {
    importError = error;
  }

  for (const req of buildWsFallbackRequires()) {
    const wsModule = tryRequireWs(req);
    if (wsModule) {
      cachedWsModule = wsModule;
      return wsModule;
    }
  }

  const message = importError instanceof Error ? importError.message : String(importError || "unknown error");
  throw new Error(`Unable to load the ws package required by Pi Phone. Tried the extension install and Pi runtime fallbacks. Last error: ${message}`);
}

function readPositivePort(value: string | undefined, fallback: number) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

function readIdleTimeoutMs() {
  const minutes = Number(process.env.PI_PHONE_IDLE_MINS ?? process.env.PI_PHONE_IDLE_MINUTES);
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes * 60_000)) : DEFAULT_IDLE_TIMEOUT_MS;
}

function isAddressInUseError(error: unknown) {
  const err = error as NodeJS.ErrnoException | null;
  return Boolean(err && (err.code === "EADDRINUSE" || err.message?.includes("EADDRINUSE")));
}

function parseSlashCommandText(text: unknown) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value.startsWith("/")) return null;

  const body = value.slice(1).trim();
  if (!body) return null;

  const spaceIndex = body.indexOf(" ");
  const name = spaceIndex === -1 ? body : body.slice(0, spaceIndex);

  return {
    text: `/${body}`,
    name,
  };
}

function sessionStartReason(event: unknown): SessionStartReason | undefined {
  const reason = (event as { reason?: unknown } | null)?.reason;
  return reason === "startup" || reason === "reload" || reason === "new" || reason === "resume" || reason === "fork"
    ? reason
    : undefined;
}

function sessionShutdownReason(event: unknown): SessionShutdownReason | undefined {
  const reason = (event as { reason?: unknown } | null)?.reason;
  return reason === "quit" || reason === "reload" || reason === "new" || reason === "resume" || reason === "fork"
    ? reason
    : undefined;
}

export class PhoneServerRuntime {
  private latestCtx: AnyCtx | null = null;
  private latestError = "";
  private config: PhoneConfig = {
    host: process.env.PI_PHONE_HOST || "127.0.0.1",
    port: readPositivePort(process.env.PI_PHONE_PORT, 8787),
    token: process.env.PI_PHONE_TOKEN || "",
    cwd: process.cwd(),
    idleTimeoutMs: readIdleTimeoutMs(),
  };
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private sessionPool: PhoneSessionPool | null = null;
  private parentWorker: PhoneParentSessionWorker | null = null;
  private latestCommandCtx: ExtensionCommandContext | null = null;
  private latestCommandCtxSessionKey: string | null = null;
  private latestLiveSessionKey: string | null = null;
  private controlOwner: "cli" | "phone" = "cli";
  private phoneSelectedSessionId: string | null = null;
  private idleStopTimer: NodeJS.Timeout | null = null;
  private lastActivityAt = Date.now();
  private runtimeControlToken = "";
  private activeRuntimeStatePath: string | null = null;

  constructor(private pi: ExtensionAPI) {}

  setPi(pi: ExtensionAPI) {
    this.pi = pi;
    this.parentWorker?.setPi(pi);
  }

  captureCtx(ctx: AnyCtx) {
    const hadCommandCtx = Boolean(this.latestCommandCtx);
    let restoredCommandCtx = false;
    let clearedCommandCtxError = false;

    this.latestCtx = ctx;
    this.latestLiveSessionKey = this.sessionKeyForCtx(ctx);
    if (typeof (ctx as ExtensionCommandContext).waitForIdle === "function") {
      this.latestCommandCtx = ctx as ExtensionCommandContext;
      this.latestCommandCtxSessionKey = this.latestLiveSessionKey;
      restoredCommandCtx = !hadCommandCtx;
      clearedCommandCtxError = Boolean(this.parentWorker?.clearCommandContextUnavailableError());
    }

    if (restoredCommandCtx || clearedCommandCtxError) {
      this.sessionPool?.broadcastCatalog();
      this.broadcastStatus();
    }

    return restoredCommandCtx;
  }

  private sessionKeyForCtx(ctx?: ExtensionContext | ExtensionCommandContext | null) {
    return ctx?.sessionManager.getSessionFile() || ctx?.sessionManager.getSessionId() || null;
  }

  private captureReplacementCtx(ctx: ExtensionCommandContext) {
    const restoredCommandCtx = this.captureCtx(ctx);
    this.syncCwdFromCtx(ctx);
    this.parentWorker?.captureContext(ctx, { emitSnapshot: true, emitCatalog: true });
    if (!restoredCommandCtx) {
      this.sessionPool?.broadcastCatalog();
    }
    this.updateStatusUi(ctx);
    this.broadcastStatus();
  }

  private clearCommandCtxForReplacement(reason: SessionStartReason | SessionShutdownReason, ctx?: ExtensionContext, phase: "start" | "shutdown" = "start") {
    // Pi >= 0.73 invalidates command contexts across session replacement. Never keep a
    // reload command ctx: reload has no withSession replacement callback, and
    // session_start only provides ExtensionContext on affected Pi versions. For
    // new/resume/fork, keep a freshly captured withSession ctx only when it points at
    // the new session (start) or no longer points at the shutting-down session.
    const eventSessionKey = this.sessionKeyForCtx(ctx);
    const hadCommandCtx = Boolean(this.latestCommandCtx);
    const hasFreshReplacementCtx = Boolean(
      reason !== "reload"
      && hadCommandCtx
      && eventSessionKey
      && (phase === "start"
        ? this.latestCommandCtxSessionKey === eventSessionKey
        : this.latestCommandCtxSessionKey !== eventSessionKey),
    );

    if (!hasFreshReplacementCtx && hadCommandCtx) {
      this.latestCommandCtx = null;
      this.latestCommandCtxSessionKey = null;
      this.parentWorker?.markCommandContextUnavailable("Command-only parent session controls are unavailable until Pi provides a fresh command context.");
      // The Active Sessions sheet reads command controls availability from the
      // session catalog summary, so broadcast it immediately when command-only
      // controls are invalidated instead of waiting for the next catalog refresh.
      this.sessionPool?.broadcastCatalog();
      this.broadcast({
        channel: "server",
        event: "command-controls-unavailable",
        data: { message: "Parent session command controls are unavailable until you run a Pi Phone slash command in the terminal." },
      });
      this.broadcastStatus();
    }

    return hasFreshReplacementCtx;
  }

  private syncCwdFromCtx(ctx: AnyCtx) {
    const nextCwd = ctx.sessionManager.getCwd() || ctx.cwd || this.config.cwd || process.cwd();
    if (nextCwd !== this.config.cwd) {
      this.config.cwd = nextCwd;
      this.sessionPool?.setCwd(nextCwd);
    }
    return nextCwd;
  }

  private activeCwd() {
    return this.latestCtx?.cwd || this.config.cwd || process.cwd();
  }

  private buildStatus() {
    if (this.sessionPool) {
      return this.sessionPool.buildOverallStatus();
    }

    const theme = buildThemePayload(this.latestCtx?.ui.theme);

    return {
      cwd: this.config.cwd,
      hasToken: Boolean(this.config.token),
      isRunning: Boolean(this.server),
      childRunning: false,
      isStreaming: false,
      lastError: this.latestError,
      pid: process.pid,
      childPid: null,
      piCommand: "live cli + parallel pi --mode rpc",
      connectedClients: 0,
      sessionCount: 0,
      host: this.config.host,
      port: this.config.port,
      idleTimeoutMs: this.config.idleTimeoutMs,
      lastActivityAt: this.lastActivityAt,
      singleClientMode: true,
      controlOwner: this.controlOwner,
      commandContextAvailable: Boolean(this.latestCommandCtx),
      ...(theme ? { theme } : {}),
    };
  }

  private generateToken() {
    const raw = randomBytes(12).toString("base64url");
    return `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 16)}`;
  }

  private send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private broadcast(payload: unknown) {
    for (const client of this.sessionPool?.getClients() || []) {
      this.send(client, payload);
    }
  }

  broadcastStatus() {
    this.sessionPool?.broadcastStatus();
  }

  private clearIdleStopTimer() {
    if (this.idleStopTimer) {
      clearTimeout(this.idleStopTimer);
      this.idleStopTimer = null;
    }
  }

  markActivity() {
    this.lastActivityAt = Date.now();
    this.scheduleIdleStop();
    this.broadcastStatus();
  }

  private scheduleIdleStop() {
    this.clearIdleStopTimer();
    if (!this.server || this.config.idleTimeoutMs <= 0) return;

    this.idleStopTimer = setTimeout(async () => {
      if (!this.server) return;
      const elapsed = Date.now() - this.lastActivityAt;
      if (elapsed < this.config.idleTimeoutMs) {
        this.scheduleIdleStop();
        return;
      }

      const idlePayload = {
        channel: "server",
        event: "idle-timeout",
        data: { message: `Pi Phone stopped after ${Math.round(this.config.idleTimeoutMs / 60000) || 1} minute(s) of inactivity.` },
      };

      if (this.sessionPool) {
        await this.sessionPool.closeAllClients({ payload: idlePayload, code: 4010, reason: "idle-timeout" });
      } else {
        this.broadcast(idlePayload);
      }

      await this.stopServer();
      await disableMatchingTailscaleServe(this.pi, this.config.port);
    }, this.config.idleTimeoutMs);
  }

  private async getActiveWorkerForClient(ws: WebSocket) {
    if (!this.sessionPool) {
      throw new Error("Pi Phone session pool is not running.");
    }
    return this.sessionPool.getActiveWorker(ws);
  }

  private async getCurrentSessionFileForWorker(worker: SessionController) {
    const stateResponse = await worker.request({ type: "get_state" });
    return stateResponse.data?.sessionFile as string | undefined;
  }

  private async getTreeStateForWorker(worker: SessionController) {
    const sessionFile = await this.getCurrentSessionFileForWorker(worker);
    if (!sessionFile) {
      throw new Error("No session file available for tree view.");
    }
    return getTreeStateFromSessionFile(sessionFile);
  }

  private async createBranchSessionFromEntryForWorker(worker: SessionController, entryId: string) {
    const sessionFile = await this.getCurrentSessionFileForWorker(worker);
    if (!sessionFile) {
      throw new Error("No active session file.");
    }
    return createBranchSessionFromEntry(sessionFile, entryId);
  }

  private async resolveRemoteSlashCommandForWorker(worker: SessionController, text: unknown): Promise<SlashCommandMatch | null> {
    const parsed = parseSlashCommandText(text);
    if (!parsed) return null;

    const commandsResponse = await worker.request({ type: "get_commands" });
    if (!commandsResponse?.success) {
      throw new Error(commandsResponse?.error || "Failed to read available slash commands.");
    }

    const match = (commandsResponse.data?.commands || []).find((command: any) => command?.name === parsed.name);
    if (!match) return null;

    return {
      ...parsed,
      source: typeof match.source === "string" ? match.source : "extension",
    };
  }

  private async dispatchRemoteSlashCommandForWorker(
    worker: SessionController,
    ws: WebSocket,
    input: {
      text: string;
      images?: unknown[];
      streamingBehavior?: "steer" | "followUp";
    },
    options: {
      responseCommand?: string;
      responseData?: Record<string, unknown>;
      onSuccess?: (payload?: unknown) => void;
      onError?: (payload?: unknown) => void;
    } = {},
  ) {
    const slashCommand = await this.resolveRemoteSlashCommandForWorker(worker, input.text);
    if (!slashCommand) {
      this.send(ws, {
        channel: "rpc",
        payload: {
          type: "response",
          command: options.responseCommand || "slash_command",
          success: false,
          error: `Unknown slash command: ${typeof input.text === "string" ? input.text : ""}`.trim() || "Unknown slash command.",
        },
      });
      return false;
    }

    const images = Array.isArray(input.images) ? input.images : [];
    if (slashCommand.source === "extension" && images.length > 0) {
      this.send(ws, {
        channel: "rpc",
        payload: {
          type: "response",
          command: options.responseCommand || "slash_command",
          success: false,
          error: "Extension slash commands do not support image attachments.",
        },
      });
      return false;
    }

    const childCommand: Record<string, unknown> = {
      type: "prompt",
      message: slashCommand.text,
    };

    if (images.length > 0) {
      childCommand.images = images;
    }

    if (slashCommand.source !== "extension" && (input.streamingBehavior === "steer" || input.streamingBehavior === "followUp")) {
      childCommand.streamingBehavior = input.streamingBehavior;
    }

    await worker.sendClientCommand(childCommand, {
      ws,
      responseCommand: options.responseCommand || "slash_command",
      responseData: {
        name: slashCommand.name,
        source: slashCommand.source,
        ...(options.responseData || {}),
      },
      onSuccess: options.onSuccess,
      onError: options.onError,
    });

    return true;
  }

  private rememberPhoneSelection(session: SessionController | null) {
    if (!session) return;
    this.phoneSelectedSessionId = session.id;
  }

  private selectedSessionId() {
    if (this.phoneSelectedSessionId && this.sessionPool?.getSession(this.phoneSelectedSessionId)) {
      return this.phoneSelectedSessionId;
    }
    return this.sessionPool?.getSelectedSessionId() || this.parentWorker?.id || null;
  }

  private selectedSession() {
    return this.sessionPool?.getSession(this.selectedSessionId()) || this.parentWorker || null;
  }

  private setControlOwner(owner: "cli" | "phone") {
    if (this.controlOwner === owner) return;
    this.controlOwner = owner;
    this.broadcastStatus();
  }

  private parentBusy() {
    const status = this.parentWorker?.getStatus();
    return Boolean(status?.isStreaming || status?.isCompacting || this.parentWorker?.pendingUiRequest);
  }

  private releaseParentOwnershipIfAvailable() {
    if (!this.parentBusy() && this.selectedSession()?.kind !== "parent") {
      this.setControlOwner("cli");
    }
  }

  private async ensurePhoneCanWrite(ws: WebSocket, worker: SessionController) {
    if (worker.kind !== "parent") {
      this.releaseParentOwnershipIfAvailable();
      return true;
    }

    if (this.controlOwner === "cli" && this.parentBusy()) {
      this.send(ws, {
        channel: "server",
        event: "client-error",
        data: { message: "Wait for the current CLI parent response to finish before editing the parent session from the phone." },
      });
      return false;
    }

    this.setControlOwner("phone");
    return true;
  }

  handleInput(event: InputEvent, ctx: ExtensionContext): InputEventResult | Promise<InputEventResult> {
    this.captureCtx(ctx);
    if (!this.server || !this.sessionPool || event.source !== "interactive") {
      return { action: "continue" };
    }
    if (this.controlOwner !== "phone") {
      return { action: "continue" };
    }

    const selected = this.selectedSession();
    if (!selected) {
      this.setControlOwner("cli");
      return { action: "continue" };
    }

    if (selected.kind !== "parent") {
      this.releaseParentOwnershipIfAvailable();
      return { action: "continue" };
    }

    this.rememberPhoneSelection(selected);
    if (this.parentBusy()) {
      ctx.ui.notify("Wait for the current phone parent response to finish before taking control back in the CLI.", "warning");
      return { action: "handled" };
    }

    this.setControlOwner("cli");
    return { action: "continue" };
  }

  handleParentAgentStart(ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleAgentStart(ctx);
  }

  handleParentAgentEnd(ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleAgentEnd(ctx);
    this.releaseParentOwnershipIfAvailable();
  }

  handleParentMessageStart(event: any, ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleMessageStart(event, ctx);
  }

  handleParentMessageUpdate(event: any, ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleMessageUpdate(event, ctx);
  }

  handleParentMessageEnd(event: any, ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleMessageEnd(event, ctx);
  }

  handleParentToolExecutionStart(event: any, ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleToolExecutionStart(event);
  }

  handleParentToolExecutionUpdate(event: any, ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleToolExecutionUpdate(event);
  }

  handleParentToolExecutionEnd(event: any, ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.handleToolExecutionEnd(event);
  }

  handleParentCompactionStart(ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.setCompacting(true, ctx);
  }

  handleParentCompactionEnd(ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.parentWorker?.setCompacting(false, ctx);
    this.releaseParentOwnershipIfAvailable();
  }

  private tokenFromRequest(req: IncomingMessage, url: URL) {
    const header = req.headers.authorization || "";
    const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    return url.searchParams.get("token") || bearer;
  }

  private isApiAuthorized(req: IncomingMessage, url: URL) {
    return !this.config.token || this.tokenFromRequest(req, url) === this.config.token;
  }

  private buildPublicHealth() {
    return {
      hasToken: Boolean(this.config.token),
      isRunning: Boolean(this.server),
      host: this.config.host,
      port: this.config.port,
    };
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    this.markActivity();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === phoneControlStopPath) {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      if (!this.runtimeControlToken || url.searchParams.get("token") !== this.runtimeControlToken || !isLoopbackAddress(req.socket.remoteAddress)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => {
        this.stopServer().catch((error) => {
          this.latestError = error instanceof Error ? error.message : String(error);
          this.broadcastStatus();
        });
      }, 0);
      return;
    }

    if (url.pathname === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(this.isApiAuthorized(req, url)
        ? this.buildStatus()
        : this.buildPublicHealth()));
      return;
    }

    if (url.pathname === "/api/quota") {
      if (!this.isApiAuthorized(req, url)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const quota = await getQuotaForModel(url.searchParams.get("provider"), url.searchParams.get("modelId"));
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(JSON.stringify(quota));
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = sanitizePublicPath(pathname);
    if (!filePath) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }

    try {
      const body = await readFile(filePath);
      const extension = extname(filePath);
      const cacheControl = [".html", ".js", ".css", ".webmanifest", ".json"].includes(extension) || pathname === "/sw.js"
        ? "no-store"
        : "public, max-age=60";
      res.writeHead(200, {
        "Content-Type": mimeTypes[extension] || "application/octet-stream",
        "Cache-Control": cacheControl,
      });
      if (req.method === "GET") res.end(body);
      else res.end();
    } catch {
      try {
        const body = await readFile(publicFilePath("index.html"));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(body);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to serve file" }));
      }
    }
  }

  async startServer() {
    if (this.server) return;

    this.sessionPool = new PhoneSessionPool({
      cwd: this.config.cwd,
      send: (ws, payload) => this.send(ws, payload),
      onActivity: () => this.markActivity(),
      buildStatusMeta: () => {
        const theme = buildThemePayload(this.latestCtx?.ui.theme);
        return {
          cwd: this.config.cwd,
          hasToken: Boolean(this.config.token),
          host: this.config.host,
          port: this.config.port,
          idleTimeoutMs: this.config.idleTimeoutMs,
          lastActivityAt: this.lastActivityAt,
          singleClientMode: true,
          controlOwner: this.controlOwner,
          commandContextAvailable: Boolean(this.latestCommandCtx),
          pid: process.pid,
          piCommand: "live cli + parallel pi --mode rpc",
          serverRunning: Boolean(this.server),
          ...(theme ? { theme } : {}),
        };
      },
      createDefaultSession: () => {
        const worker = new PhoneParentSessionWorker(
          {
            cwd: this.config.cwd,
            send: (ws, payload) => this.send(ws, payload),
            onActivity: () => this.markActivity(),
            onStateChange: () => {
              this.sessionPool?.notifySessionStateChanged(worker);
              if ((this.sessionPool?.clientCount || 0) === 0) {
                this.setControlOwner("cli");
              }
            },
            onEnvelope: (_currentWorker, envelope) => {
              this.sessionPool?.forwardSessionEnvelope(worker, envelope);
            },
            shouldAutoRestart: () => false,
            getCtx: () => this.latestCtx,
            getCommandCtx: () => this.latestCommandCtx,
            onReplacementContext: (replacementCtx) => this.captureReplacementCtx(replacementCtx),
          },
          this.pi,
        );
        this.parentWorker = worker;
        if (!this.phoneSelectedSessionId) {
          this.rememberPhoneSelection(worker);
        }
        return worker;
      },
      createParallelSession: (sessionFile) => {
        let worker: PhoneSessionWorker;
        worker = new PhoneSessionWorker(
          {
            cwd: this.config.cwd,
            send: (ws, payload) => this.send(ws, payload),
            onActivity: () => this.markActivity(),
            onStateChange: () => {
              this.sessionPool?.notifySessionStateChanged(worker);
              if ((this.sessionPool?.clientCount || 0) === 0) {
                this.setControlOwner("cli");
              }
            },
            onEnvelope: (_currentWorker, envelope) => {
              this.sessionPool?.forwardSessionEnvelope(worker, envelope);
            },
            shouldAutoRestart: (currentWorker) => Boolean(this.sessionPool && this.sessionPool.clientCount > 0 && this.sessionPool.getSession(currentWorker.id)),
          },
          sessionFile,
        );
        return worker;
      },
    });

    this.server = createServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        this.latestError = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: this.latestError }));
        this.broadcastStatus();
      });
    });

    const { WebSocketServer } = await loadWsModule();
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (ws: WebSocket) => {
      if (this.sessionPool && this.sessionPool.clientCount > 0) {
        this.sessionPool.closeAllClients({
          payload: {
            channel: "server",
            event: "single-client-replaced",
            data: { message: "This Pi Phone instance was opened from another device or tab." },
          },
          code: 4009,
          reason: "replaced-by-new-client",
        }).catch(() => {});
      }

      this.markActivity();
      this.sessionPool?.addClient(ws).catch((error) => {
        this.send(ws, {
          channel: "server",
          event: "snapshot-error",
          data: { message: error instanceof Error ? error.message : String(error) },
        });
      });
      this.broadcastStatus();

      ws.on("close", () => {
        this.sessionPool?.removeClient(ws);
        if ((this.sessionPool?.clientCount || 0) === 0) {
          this.setControlOwner("cli");
        }
        this.markActivity();
        this.broadcastStatus();
      });

      ws.on("message", (raw: RawData) => {
        this.markActivity();
        this.handleClientMessage(ws, raw.toString()).catch((error) => {
          this.send(ws, {
            channel: "server",
            event: "client-error",
            data: { message: error instanceof Error ? error.message : String(error) },
          });
        });
      });
    });

    this.server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const tokenMismatch = Boolean(this.config.token && url.searchParams.get("token") !== this.config.token);

      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        if (tokenMismatch) {
          ws.close(1008, "invalid-token");
          return;
        }

        this.wss?.emit("connection", ws, req);
      });
    });

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        this.server?.once("error", rejectPromise);
        this.server?.listen(this.config.port, this.config.host, () => resolvePromise());
      });

      this.latestError = "";
      this.runtimeControlToken = this.generateToken();
      this.markActivity();
      await this.sessionPool.ensureDefaultWorker();
      this.activeRuntimeStatePath = await writePersistedRuntimeState(this.config.host, this.config.port, this.runtimeControlToken);
      this.broadcastStatus();
      this.syncStatusUi();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stopServer();
      this.latestError = message;
      this.broadcastStatus();
      this.syncStatusUi();
      throw error;
    }
  }

  async stopServer() {
    this.clearIdleStopTimer();

    const runtimeStatePath = this.activeRuntimeStatePath;
    this.runtimeControlToken = "";

    if (this.sessionPool) {
      await this.sessionPool.dispose();
      this.sessionPool = null;
    }
    this.parentWorker = null;
    this.controlOwner = "cli";
    this.phoneSelectedSessionId = null;

    if (this.wss) {
      const runningWss = this.wss;
      await new Promise<void>((resolvePromise) => {
        runningWss.close(() => resolvePromise());
      });
      this.wss = null;
    }

    if (this.server) {
      const runningServer = this.server;
      await new Promise<void>((resolvePromise) => {
        try {
          runningServer.close(() => resolvePromise());
        } catch {
          resolvePromise();
        }
      });
      this.server = null;
    }

    await removePersistedRuntimeState(runtimeStatePath);
    this.activeRuntimeStatePath = null;
    this.latestError = "";
    this.broadcastStatus();
    this.syncStatusUi();
  }

  private async handleClientMessage(ws: WebSocket, raw: string) {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      this.send(ws, { channel: "server", event: "client-error", data: { message: "Invalid JSON from client." } });
      return;
    }

    if (!this.sessionPool) {
      throw new Error("Pi Phone session pool is not running.");
    }

    if (message.kind === "refresh") {
      await this.sessionPool.refreshActiveSnapshot(ws);
      return;
    }

    if (message.kind === "session-select") {
      const sessionId = String(message.sessionId || "");
      await this.sessionPool.selectSession(ws, sessionId);
      this.rememberPhoneSelection(this.sessionPool.getSession(sessionId));
      this.releaseParentOwnershipIfAvailable();
      return;
    }

    if (message.kind === "session-parent-new") {
      if (!this.parentWorker) {
        await this.sessionPool.ensureDefaultWorker();
      }
      const worker = this.parentWorker;
      if (!worker || worker.kind !== "parent") {
        throw new Error("Parent session is not available.");
      }
      if (!(await this.ensurePhoneCanWrite(ws, worker))) {
        return;
      }
      await this.sessionPool.selectSession(ws, worker.id);
      this.sessionPool.setDefaultWorker(worker.id);
      this.rememberPhoneSelection(worker);
      await worker.sendClientCommand({ type: "new_session" }, {
        ws,
        responseCommand: "new_parent_session",
      });
      return;
    }

    if (message.kind === "session-spawn") {
      const worker = await this.sessionPool.spawnSession(ws);
      this.rememberPhoneSelection(worker);
      this.releaseParentOwnershipIfAvailable();
      this.send(ws, { channel: "server", event: "session-spawned", data: { message: "Opened new parallel session." } });
      return;
    }

    if (message.kind === "local-command") {
      const worker = await this.getActiveWorkerForClient(ws);
      this.rememberPhoneSelection(worker);
      const localCommandType = message.command && typeof message.command === "object" ? message.command.type : message.command;
      const localCommandMutates = localCommandType === "reload" || localCommandType === "cd" || localCommandType === "slash-command";
      if (localCommandMutates && !(await this.ensurePhoneCanWrite(ws, worker))) {
        return;
      }

      if (message.command === "reload") {
        try {
          await worker.reload();
          const commandControlsAvailable = worker.kind !== "parent" || Boolean(this.latestCommandCtx);
          this.send(ws, {
            channel: "rpc",
            payload: {
              type: "response",
              command: "reload",
              success: true,
              data: {
                sessionFile: worker.currentSessionFile,
                commandControlsAvailable,
                ...(commandControlsAvailable ? {} : { warning: "Reload succeeded, but parent session command controls are unavailable until a fresh command context is captured." }),
              },
            },
          });
          await this.sessionPool.refreshActiveSnapshot(ws);
        } catch (error) {
          this.send(ws, {
            channel: "rpc",
            payload: {
              type: "response",
              command: "reload",
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return;
      }

      if (message.command && typeof message.command === "object" && message.command.type === "path-suggestions") {
        try {
          const mode = message.command.mode === "cd" ? "cd" : "mention";
          const query = typeof message.command.query === "string" ? message.command.query : "";
          const suggestions = listPhonePathSuggestions(mode, query, worker.cwd, worker.previousCwd);

          this.send(ws, {
            channel: "rpc",
            payload: {
              type: "response",
              command: "path_suggestions",
              success: true,
              data: {
                mode,
                query,
                cwd: worker.cwd,
                requestId: Number(message.command.requestId) || 0,
                suggestions,
              },
            },
          });
        } catch (error) {
          this.send(ws, {
            channel: "rpc",
            payload: {
              type: "response",
              command: "path_suggestions",
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return;
      }

      if (message.command && typeof message.command === "object" && message.command.type === "cd") {
        try {
          const args = typeof message.command.args === "string" ? message.command.args : "";
          const nextCwd = resolvePhoneCdTargetPath(args, worker.cwd, worker.previousCwd);

          if (!existsSync(nextCwd)) {
            throw new Error(`Directory does not exist: ${nextCwd}`);
          }
          if (!statSync(nextCwd).isDirectory()) {
            throw new Error(`Not a directory: ${nextCwd}`);
          }

          const previousCwd = worker.cwd;
          const slashText = args.trim() ? `/cd ${args}` : "/cd";
          const dispatched = await this.dispatchRemoteSlashCommandForWorker(
            worker,
            ws,
            { text: slashText },
            {
              responseCommand: "cd",
              responseData: { cwd: nextCwd, previousCwd },
              onSuccess: () => {
                worker.setTrackedCwd?.(nextCwd, previousCwd);
                this.sessionPool?.setCwd(nextCwd);
                this.config.cwd = nextCwd;
              },
            },
          );

          if (!dispatched) return;
        } catch (error) {
          this.send(ws, {
            channel: "rpc",
            payload: {
              type: "response",
              command: "cd",
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return;
      }

      if (message.command && typeof message.command === "object" && message.command.type === "slash-command") {
        try {
          await this.dispatchRemoteSlashCommandForWorker(worker, ws, {
            text: String(message.command.text || ""),
            images: Array.isArray(message.command.images) ? message.command.images : [],
            streamingBehavior: message.command.streamingBehavior === "steer"
              ? "steer"
              : message.command.streamingBehavior === "followUp"
                ? "followUp"
                : undefined,
          });
        } catch (error) {
          this.send(ws, {
            channel: "rpc",
            payload: {
              type: "response",
              command: "slash_command",
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        return;
      }

      this.send(ws, { channel: "server", event: "client-error", data: { message: "Unsupported local command." } });
      return;
    }

    if (message.kind !== "rpc" || !message.command || typeof message.command !== "object") {
      this.send(ws, { channel: "server", event: "client-error", data: { message: "Unsupported client command." } });
      return;
    }

    const command = { ...message.command };

    if (command.type === "phone_list_sessions") {
      const worker = await this.getActiveWorkerForClient(ws);
      const sessions = await listSessionsForCwd(worker.cwd || this.config.cwd);
      this.send(ws, {
        channel: "rpc",
        payload: {
          type: "response",
          command: "phone_list_sessions",
          success: true,
          data: { sessions, cwd: worker.cwd || this.config.cwd },
          ...(command.id ? { id: command.id } : {}),
        },
      });
      return;
    }

    const worker = await this.getActiveWorkerForClient(ws);
    this.rememberPhoneSelection(worker);
    const readOnlyCommandTypes = new Set(["get_state", "get_messages", "get_commands", "get_available_models", "get_session_stats", "phone_get_tree", "phone_list_sessions"]);
    if (!readOnlyCommandTypes.has(String(command.type || "")) && !(await this.ensurePhoneCanWrite(ws, worker))) {
      return;
    }

    if (command.type === "phone_get_tree") {
      const tree = await this.getTreeStateForWorker(worker);
      this.send(ws, {
        channel: "rpc",
        payload: {
          type: "response",
          command: "phone_get_tree",
          success: true,
          data: tree,
          ...(command.id ? { id: command.id } : {}),
        },
      });
      return;
    }

    if (command.type === "phone_open_branch_path") {
      const nextPath = await this.createBranchSessionFromEntryForWorker(worker, String(command.entryId || ""));
      const switchResponse = await worker.request({ type: "switch_session", sessionPath: nextPath });
      this.send(ws, {
        channel: "rpc",
        payload: {
          type: "response",
          command: "phone_open_branch_path",
          success: true,
          data: { path: nextPath, switchResult: switchResponse.data },
          ...(command.id ? { id: command.id } : {}),
        },
      });
      await this.sessionPool.refreshActiveSnapshot(ws);
      this.broadcastStatus();
      return;
    }

    await worker.sendClientCommand(command, { ws });
  }

  updateStatusUi(ctx: AnyCtx) {
    const theme = ctx.ui.theme;
    if (this.server) {
      const dot = theme.fg("success", "●");
      const label = theme.fg("muted", " phone on");
      ctx.ui.setStatus("pi-phone", `📱 ${dot}${label}`);
    } else {
      const dot = theme.fg("dim", "○");
      const label = theme.fg("dim", " phone off");
      ctx.ui.setStatus("pi-phone", `📱 ${dot}${label}`);
    }
  }

  syncStatusUi() {
    if (!this.latestCtx) return;
    this.updateStatusUi(this.latestCtx);
  }

  statusText() {
    const url = `http://${this.config.host}:${this.config.port}`;
    const idleMinutes = this.config.idleTimeoutMs > 0 ? `${Math.max(1, Math.round(this.config.idleTimeoutMs / 60_000))}m idle auto-stop` : "idle auto-stop disabled";
    return this.server
      ? `Pi Phone running at ${url} for ${this.config.cwd}${this.config.token ? " (token enabled)" : " (no token)"} · mirroring the current CLI session with optional parallel sessions · owner: ${this.controlOwner} · ${idleMinutes}`
      : "Pi Phone is stopped";
  }

  async handlePhoneStart(args: string | undefined, ctx: ExtensionCommandContext) {
    this.captureCtx(ctx);
    this.config.cwd = this.activeCwd();
    const parsed = parsePhoneStartArgs(args, this.config);
    const nextConfig = parsed.config;

    if (!nextConfig.token && !parsed.tokenSpecified) {
      nextConfig.token = this.generateToken();
    }

    const changed = ["host", "port", "token", "cwd", "idleTimeoutMs"].some(
      (key) => nextConfig[key as keyof PhoneConfig] !== this.config[key as keyof PhoneConfig],
    );
    const generatedToken = nextConfig.token && nextConfig.token !== this.config.token && !parsed.tokenSpecified;
    this.config = nextConfig;

    if (this.server && changed) {
      await this.stopServer();
    }

    if (!this.server) {
      try {
        await this.startServer();
      } catch (error) {
        if (isAddressInUseError(error)) {
          this.latestError = error instanceof Error ? error.message : String(error);
          this.updateStatusUi(ctx);
          const existingRuntime = await readPersistedRuntimeState(this.config.host, this.config.port);
          ctx.ui.notify(
            existingRuntime
              ? `Another Pi Phone instance is already using ${this.config.host}:${this.config.port}. Run /phone-stop, then /phone-start again.`
              : `Port ${this.config.host}:${this.config.port} is already in use. If it is another Pi Phone instance, run /phone-stop, then /phone-start again.`,
            "warning",
          );
          return;
        }
        throw error;
      }
    }

    await this.sessionPool?.ensureDefaultWorker();
    const tailscale = await enableTailscaleServe(this.pi, this.config.port);
    this.updateStatusUi(ctx);
    ctx.ui.notify(this.statusText(), "info");
    if (tailscale.enabled) {
      if (tailscale.changed) {
        ctx.ui.notify(`Tailscale Serve ready${tailscale.url ? `: ${tailscale.url}` : " for this device."}`, "info");
        if (tailscale.replacedExisting) {
          ctx.ui.notify("Updated the current Tailscale Serve web route to point to Pi Phone.", "warning");
        }
      } else {
        ctx.ui.notify(`Tailscale Serve already points to Pi Phone${tailscale.url ? `: ${tailscale.url}` : "."}`, "info");
      }
    } else if (tailscale.error) {
      ctx.ui.notify(`Could not configure Tailscale Serve automatically: ${tailscale.error}`, "warning");
      ctx.ui.notify(`Manual fallback: tailscale serve --bg --https=443 http://127.0.0.1:${this.config.port}`, "info");
    }
    if (generatedToken) {
      ctx.ui.notify(`Generated token: ${this.config.token}`, "warning");
    } else if (this.config.token) {
      ctx.ui.notify("Token required: use the token you started this server with.", "info");
    }
  }

  async handlePhoneStop(ctx: ExtensionCommandContext) {
    this.captureCtx(ctx);
    const hadLocalServer = Boolean(this.server);
    await this.stopServer();
    const externalStop = hadLocalServer ? null : await stopPersistedRuntime(this.config.host, this.config.port);
    const tailscale = await disableMatchingTailscaleServe(this.pi, this.config.port);
    this.updateStatusUi(ctx);

    if (hadLocalServer || externalStop?.stopped) {
      if (tailscale.disabled) {
        ctx.ui.notify("Pi Phone stopped and matching Tailscale Serve route disabled", "info");
      } else {
        ctx.ui.notify("Pi Phone stopped", "info");
        if (tailscale.error) {
          ctx.ui.notify(`Could not disable Tailscale Serve automatically: ${tailscale.error}`, "warning");
        }
      }
      return;
    }

    if (externalStop?.found && externalStop.message) {
      const kind = externalStop.message.startsWith("Removed stale") ? "info" : "warning";
      ctx.ui.notify(externalStop.message, kind);
    } else {
      ctx.ui.notify("Pi Phone is already stopped.", "info");
    }

    if (tailscale.disabled) {
      ctx.ui.notify("Disabled the matching Tailscale Serve route.", "info");
    } else if (tailscale.error) {
      ctx.ui.notify(`Could not disable Tailscale Serve automatically: ${tailscale.error}`, "warning");
    }
  }

  async handlePhoneStatus(ctx: ExtensionCommandContext) {
    this.captureCtx(ctx);
    this.updateStatusUi(ctx);
    ctx.ui.notify(this.statusText(), this.server ? "info" : "warning");

    const tailscale = await getTailscaleServeInfo(this.pi, this.config.port);
    if (tailscale.active) {
      if (this.server) {
        ctx.ui.notify(`Tailscale Serve: ${tailscale.url || "enabled for Pi Phone"}`, "info");
      } else {
        ctx.ui.notify(`Tailscale Serve is still pointing at Pi Phone${tailscale.url ? `: ${tailscale.url}` : "."}`, "warning");
      }
    } else if (this.server) {
      if (tailscale.error) {
        ctx.ui.notify(`Tailscale Serve check failed: ${tailscale.error}`, "warning");
      } else {
        ctx.ui.notify("Tailscale Serve is not currently pointing to Pi Phone.", "warning");
      }
    }
  }

  handlePhoneToken(ctx: ExtensionCommandContext) {
    this.captureCtx(ctx);
    if (this.config.token) {
      ctx.ui.notify(`Pi Phone token: ${this.config.token}`, "warning");
    } else {
      ctx.ui.notify("Pi Phone token is disabled for this server.", "info");
    }
  }

  async handleSessionStart(event: unknown, ctx: ExtensionContext) {
    const reason = sessionStartReason(event);
    if (reason === "new" || reason === "resume" || reason === "fork" || reason === "reload") {
      this.clearCommandCtxForReplacement(reason, ctx);
      await this.handleSessionSwitch(ctx);
      return;
    }

    if (this.server && this.latestCommandCtx && typeof (ctx as ExtensionCommandContext).waitForIdle !== "function") {
      this.clearCommandCtxForReplacement("reload", ctx);
    }

    this.captureCtx(ctx);
    this.syncCwdFromCtx(ctx);
    if (this.server) {
      this.parentWorker?.captureContext(ctx, { emitSnapshot: true });
      if (!this.phoneSelectedSessionId || !this.sessionPool?.getSession(this.phoneSelectedSessionId)) {
        this.rememberPhoneSelection(this.parentWorker);
      }
    }
    this.updateStatusUi(ctx);
    this.broadcastStatus();
  }

  async handleSessionSwitch(ctx: ExtensionContext) {
    this.captureCtx(ctx);
    this.syncCwdFromCtx(ctx);
    if (this.server) {
      this.parentWorker?.captureContext(ctx, { emitSnapshot: true });
      if (!this.phoneSelectedSessionId || this.phoneSelectedSessionId === this.parentWorker?.id) {
        this.rememberPhoneSelection(this.parentWorker);
      }
    }
    this.updateStatusUi(ctx);
    this.broadcastStatus();
  }

  async handleSessionShutdown(event: unknown, ctx: ExtensionContext) {
    const reason = sessionShutdownReason(event);
    if (reason === "new" || reason === "resume" || reason === "fork" || reason === "reload") {
      const shutdownSessionKey = this.sessionKeyForCtx(ctx);
      const hasFreshReplacementCtx = this.clearCommandCtxForReplacement(reason, ctx, "shutdown");
      // A replacement/reload context may already be live when Pi emits shutdown
      // for the old session. Do not let that stale ExtensionContext become
      // latestCtx again, or parent controls/snapshots can regress to the old
      // session and appear unavailable.
      if (shutdownSessionKey && this.latestLiveSessionKey && shutdownSessionKey !== this.latestLiveSessionKey) {
        this.broadcastStatus();
        return;
      }
      if (!hasFreshReplacementCtx) {
        this.captureCtx(ctx);
        this.syncCwdFromCtx(ctx);
        this.updateStatusUi(ctx);
      } else {
        this.broadcastStatus();
      }
      return;
    }

    this.captureCtx(ctx);
    await this.stopServer();
    await disableMatchingTailscaleServe(this.pi, this.config.port);
    this.updateStatusUi(ctx);
  }
}
