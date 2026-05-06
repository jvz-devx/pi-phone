import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { createServer, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { PhoneServerRuntime, type PhoneLaunchInfo } from "./phone-server-runtime";
import { getTailscaleServeInfo } from "./phone-tailscale";

type PiPhoneGlobalState = {
  runtime?: PhoneServerRuntime;
  registeredApis?: WeakSet<ExtensionAPI>;
};

function getGlobalState() {
  const globalKey = "__piPhoneExtensionState";
  const root = globalThis as typeof globalThis & Record<string, PiPhoneGlobalState | undefined>;
  root[globalKey] ||= {};
  return root[globalKey];
}

function isUnsupportedCompatEventError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /unknown event|unsupported event|invalid event|not.*event/i.test(message);
}

function onCompat(pi: ExtensionAPI, eventName: string, handler: (event: any, ctx: any) => unknown) {
  try {
    (pi as any).on(eventName, handler);
  } catch (error) {
    // Pi >= 0.65 removed some session transition events. Keep best-effort registration
    // for older Pi releases without failing extension startup on newer versions.
    if (!isUnsupportedCompatEventError(error)) {
      console.warn(`Skipping compatibility event registration for ${eventName}:`, error);
    }
  }
}

function readPositivePort(value: string | undefined, fallback: number) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

function phoneShortcutDefaults() {
  return {
    host: process.env.PI_PHONE_HOST || "0.0.0.0",
    port: readPositivePort(process.env.PI_PHONE_PORT, 8787),
    token: process.env.PI_PHONE_TOKEN || "",
    idleMins: Number.isFinite(Number(process.env.PI_PHONE_IDLE_MINS ?? process.env.PI_PHONE_IDLE_MINUTES))
      ? Math.max(0, Number(process.env.PI_PHONE_IDLE_MINS ?? process.env.PI_PHONE_IDLE_MINUTES))
      : 9999,
  };
}

function hasExplicitPort(args: string | undefined) {
  return /(?:^|\s)(?:--port(?:=|\s+)\d+|\d+)(?:\s|$)/.test(args || "");
}

function canListen(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(host: string, start: number) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(host, port)) return port;
  }
  return start;
}

function buildPhoneArgs(options: { host: string; port: number; token: string; idleMins: number }, extraArgs = "") {
  const tokenArg = options.token ? ` --token ${options.token}` : "";
  return `--host ${options.host} --port ${options.port}${tokenArg} --idle-mins ${options.idleMins} ${extraArgs}`.trim();
}

type PhoneQrChoice = {
  label: string;
  url: string;
};

type QrCodeApi = {
  toString(text: string, options: { type: "terminal"; small?: boolean; margin?: number }): Promise<string>;
};

async function renderTerminalQr(loginUrl: string) {
  const moduleValue = await import("qrcode");
  const qrCode = ((moduleValue as { default?: QrCodeApi }).default || moduleValue) as QrCodeApi;
  if (typeof qrCode.toString !== "function") {
    throw new Error("qrcode did not export a terminal renderer.");
  }
  return qrCode.toString(loginUrl, { type: "terminal", small: true, margin: 1 });
}

function isUsefulLocalAddress(address: string) {
  if (address.startsWith("169.254.")) return false;
  return true;
}

function isWildcardHost(host: string) {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function formatHostForUrl(host: string) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function normalizeChoiceHost(host: string) {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackChoiceHost(host: string) {
  const normalized = normalizeChoiceHost(host);
  if (normalized === "localhost" || normalized === "::1") return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  return Boolean(ipv4Mapped?.startsWith("127."));
}

function localAddressChoices(host: string, port: number, token: string) {
  const choices: PhoneQrChoice[] = [];
  const seen = new Set<string>();
  const allowRemote = Boolean(token);
  const addChoice = (labelHost: string) => {
    if (!allowRemote && !isLoopbackChoiceHost(labelHost)) return;
    if (seen.has(labelHost)) return;
    seen.add(labelHost);
    const baseUrl = `http://${formatHostForUrl(labelHost)}:${port}/`;
    choices.push({ label: `${labelHost} — ${baseUrl}`, url: buildLoginUrl(baseUrl, token) });
  };

  if (!isWildcardHost(host)) {
    addChoice(host);
    return choices;
  }

  addChoice("localhost");
  if (!allowRemote) return choices;

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal || !isUsefulLocalAddress(entry.address)) continue;
      addChoice(entry.address);
    }
  }

  return choices;
}

function buildLoginUrl(baseUrl: string, token: string) {
  const url = new URL(baseUrl);
  if (token) url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function normalizeManualPhoneUrl(input: string, port: number, token: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (!token && !isLoopbackChoiceHost(url.hostname)) return "";
    if (!url.port) url.port = String(port);
    if (!url.pathname || url.pathname === "/") url.pathname = "/";
    return buildLoginUrl(url.toString(), token);
  } catch {
    return "";
  }
}

async function phoneQrChoices(pi: ExtensionAPI, host: string, port: number, token: string) {
  const choices = localAddressChoices(host, port, token);
  if (token) {
    const tailscale = await getTailscaleServeInfo(pi, port);
    if (tailscale.active && tailscale.url) {
      choices.push({ label: `Tailscale — ${tailscale.url}`, url: buildLoginUrl(tailscale.url, token) });
    }
  }
  return choices;
}

function launchInfoFromRuntime(runtime: PhoneServerRuntime, launch: PhoneLaunchInfo | null | undefined) {
  if (launch) return launch;

  const runtimeWithGetter = runtime as PhoneServerRuntime & { getLaunchInfo?: () => PhoneLaunchInfo | null };
  if (typeof runtimeWithGetter.getLaunchInfo === "function") {
    try {
      const currentLaunch = runtimeWithGetter.getLaunchInfo();
      if (currentLaunch) return currentLaunch;
    } catch {
      // Fall through to the stale-runtime compatibility path below.
    }
  }

  // Compatibility for a /reload after upgrading from pi-phone <= 0.0.13: the old
  // runtime object is intentionally kept in globalThis so the live server survives,
  // but its handlePhoneStart() returned void and did not expose getLaunchInfo().
  const staleRuntime = runtime as unknown as { server?: unknown; config?: Partial<PhoneLaunchInfo> };
  if (!staleRuntime.server || !staleRuntime.config) return null;
  const { host, port, token, cwd } = staleRuntime.config;
  if (typeof host !== "string" || typeof port !== "number") return null;
  return {
    host,
    port,
    token: typeof token === "string" ? token : "",
    cwd: typeof cwd === "string" ? cwd : process.cwd(),
  } satisfies PhoneLaunchInfo;
}

async function maybeShowPhoneQr(pi: ExtensionAPI, launch: PhoneLaunchInfo | null, ctx: ExtensionCommandContext) {
  if (!launch) {
    ctx.ui.notify("Pi Phone did not start, so no QR code was shown.", "warning");
    return;
  }

  if (!launch.token) {
    ctx.ui.notify("Remote QR login requires token auth; showing loopback/localhost choices only.", "warning");
  }

  const choices = await phoneQrChoices(pi, launch.host, launch.port, launch.token);
  const manualLabel = "Manual entry…";
  const selected = await ctx.ui.select("Which address should the QR code open?", [
    ...choices.map((choice) => choice.label),
    manualLabel,
  ]);

  let loginUrl = choices.find((choice) => choice.label === selected)?.url || "";
  if (selected === manualLabel) {
    const manual = await ctx.ui.input("Phone address", launch.token ? `192.168.1.50:${launch.port}` : `localhost:${launch.port}`);
    loginUrl = manual ? normalizeManualPhoneUrl(manual, launch.port, launch.token) : "";
  }

  if (!loginUrl) {
    ctx.ui.notify(launch.token ? "No phone QR address selected." : "No loopback/localhost QR address selected; remote tokenless QR login is not allowed.", "info");
    return;
  }

  let qr = "";
  try {
    qr = await renderTerminalQr(loginUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not render Pi Phone QR code because the qrcode package is unavailable or failed: ${message}\n\nOpen this URL manually instead:\n${loginUrl}`, "warning");
    return;
  }

  const tokenNote = launch.token ? "This login link includes the active Pi Phone token in the URL fragment." : "Token auth is disabled for this loopback-only link.";
  ctx.ui.notify(`Pi Phone QR login\n\n${loginUrl}\n\n${qr}\n${tokenNote}`, "info");
}

export default function registerPhoneExtension(pi: ExtensionAPI) {
  if (process.env.PI_PHONE_CHILD === "1") {
    return;
  }

  const state = getGlobalState();
  state.registeredApis ||= new WeakSet<ExtensionAPI>();
  if (state.registeredApis.has(pi)) {
    return;
  }

  const runtime = state.runtime || new PhoneServerRuntime(pi);
  state.runtime = runtime;
  runtime.setPi(pi);
  state.registeredApis.add(pi);

  pi.registerCommand("phone-start", {
    description: "Start the phone web UI. Usage: /phone-start [port] [token] [--cwd path] [--host 127.0.0.1] [--idle-mins 20]. Token '-' is loopback-only; use a token for remote access.",
    handler: async (args, ctx) => {
      await runtime.handlePhoneStart(args, ctx);
    },
  });

  pi.registerCommand("phone", {
    description: "Start Pi Phone with LAN-friendly defaults, optionally showing a QR login code after selecting an address/IP.",
    handler: async (args, ctx) => {
      const qrChoice = await ctx.ui.select("Show a Pi Phone QR login code?", ["Show QR code", "Skip QR code"]);
      if (qrChoice === undefined) {
        ctx.ui.notify("Pi Phone startup cancelled.", "info");
        return;
      }
      if (qrChoice !== "Show QR code" && qrChoice !== "Skip QR code") {
        ctx.ui.notify("Pi Phone startup cancelled.", "info");
        return;
      }

      const defaults = phoneShortcutDefaults();
      const port = hasExplicitPort(args) ? defaults.port : await findFreePort(defaults.host, defaults.port);
      const startResult = await runtime.handlePhoneStart(buildPhoneArgs({ ...defaults, port }, args || ""), ctx);
      const launch = launchInfoFromRuntime(runtime, startResult);
      if (qrChoice === "Show QR code") await maybeShowPhoneQr(pi, launch, ctx);
    },
  });

  pi.registerCommand("phone-lan", {
    description: "Start Pi Phone on PI_PHONE_HOST/0.0.0.0 and PI_PHONE_PORT/8787 with optional PI_PHONE_TOKEN.",
    handler: async (args, ctx) => {
      const defaults = phoneShortcutDefaults();
      await runtime.handlePhoneStart(buildPhoneArgs(defaults, args || ""), ctx);
    },
  });

  pi.registerCommand("phone-stop", {
    description: "Stop the phone web UI server and remove the matching Tailscale Serve route",
    handler: async (_args, ctx) => {
      await runtime.handlePhoneStop(ctx);
    },
  });

  pi.registerCommand("phone-status", {
    description: "Show phone server and Tailscale Serve status",
    handler: async (_args, ctx) => {
      await runtime.handlePhoneStatus(ctx);
    },
  });

  pi.registerCommand("phone-token", {
    description: "Show the current phone UI token",
    handler: async (_args, ctx) => {
      runtime.handlePhoneToken(ctx);
    },
  });

  pi.on("input", async (event, ctx) => {
    return runtime.handleInput(event, ctx);
  });

  pi.on("session_start", async (event, ctx) => {
    await runtime.handleSessionStart(event as any, ctx);
  });

  onCompat(pi, "session_switch", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  onCompat(pi, "session_fork", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    runtime.handleParentCompactionStart(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    runtime.handleParentCompactionEnd(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    runtime.handleParentAgentStart(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    runtime.handleParentAgentEnd(ctx);
  });

  pi.on("message_start", async (event, ctx) => {
    runtime.handleParentMessageStart(event, ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    runtime.handleParentMessageUpdate(event, ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    runtime.handleParentMessageEnd(event, ctx);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    runtime.handleParentToolExecutionStart(event, ctx);
  });

  pi.on("tool_execution_update", async (event, ctx) => {
    runtime.handleParentToolExecutionUpdate(event, ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    runtime.handleParentToolExecutionEnd(event, ctx);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await runtime.handleSessionShutdown(event as any, ctx);
  });
}
