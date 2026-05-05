import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServer } from "node:net";
import { PhoneServerRuntime } from "./phone-server-runtime";

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
    description: "Start the phone web UI. Usage: /phone-start [port] [token] [--cwd path] [--host 127.0.0.1] [--idle-mins 20]",
    handler: async (args, ctx) => {
      await runtime.handlePhoneStart(args, ctx);
    },
  });

  pi.registerCommand("phone", {
    description: "Start Pi Phone with LAN-friendly defaults, auto-picking a free port from PI_PHONE_PORT/8787. Add args to override.",
    handler: async (args, ctx) => {
      const defaults = phoneShortcutDefaults();
      const port = hasExplicitPort(args) ? defaults.port : await findFreePort(defaults.host, defaults.port);
      await runtime.handlePhoneStart(buildPhoneArgs({ ...defaults, port }, args || ""), ctx);
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
