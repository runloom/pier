import { existsSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";
import type {
  LaunchSpawnResult,
  LaunchWrapHandler,
  LaunchWrapResult,
} from "@pier/plugin-api/main";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import { createLogger } from "@shared/logger.ts";
import { resolveLocalControlSocketPath } from "../../adapters/cli/local-control/server.ts";
import { withPanelStatusEnv } from "../../ipc/terminal/create-launch.ts";
import { isForbiddenLaunchWrapEnvKey } from "../process-environment/apply-host-env.ts";
import { mergeSystemSkillExtraRootEnv } from "../project-skills/system-skills/extra-root.ts";
import { isHostPanelIdentityEnvKey } from "./ephemeral.ts";
import {
  listLaunchWrapHandlers,
  rememberDecorateSpawnFlag,
} from "./registry.ts";

const log = createLogger("terminal-launch-wrap");

export interface WrapT1Result {
  decorateSpawn: boolean;
  launch: ResolvedTerminalLaunchOptions;
}

function sanitizeEnvPatch(
  patch: Record<string, string> | undefined
): Record<string, string> {
  if (!patch) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isForbiddenLaunchWrapEnvKey(key) || isHostPanelIdentityEnvKey(key)) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function prependPathDirs(
  env: Record<string, string>,
  dirs: readonly string[],
  pluginId: string
): Record<string, string> {
  const existing = (env.PATH ?? process.env.PATH ?? "")
    .split(delimiter)
    .filter((part) => part);
  const seen = new Set(existing);
  const prepended: string[] = [];
  for (const dir of dirs) {
    if (!isAbsolute(dir)) {
      log.warn("launch wrap pathPrepend ignored non-absolute path", {
        path: dir,
        pluginId,
      });
      continue;
    }
    if (seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    prepended.push(dir);
  }
  if (prepended.length === 0) {
    return env;
  }
  return {
    ...env,
    PATH: [...prepended, ...existing].join(delimiter),
  };
}

function launchCommand(launch: ResolvedTerminalLaunchOptions): string {
  return launch.command ?? "";
}

export async function applyWrapT1(
  launch: ResolvedTerminalLaunchOptions
): Promise<WrapT1Result> {
  if (!launch.agentId) {
    return { decorateSpawn: false, launch };
  }
  const handlers = listLaunchWrapHandlers();
  if (handlers.length === 0) {
    return { decorateSpawn: false, launch };
  }

  let command = launchCommand(launch);
  let env = { ...(launch.env ?? {}) };
  let decorateSpawn = false;

  for (const { handler, pluginId } of handlers) {
    let result: LaunchWrapResult;
    try {
      result = await handler.wrap({
        agentId: launch.agentId,
        command,
        env: { ...env },
        ...(launch.cwd ? { cwd: launch.cwd } : {}),
      });
    } catch (error) {
      log.warn("launch wrap handler failed", {
        error: error instanceof Error ? error.message : String(error),
        pluginId,
      });
      continue;
    }
    if (typeof result.command === "string" && result.command.trim()) {
      command = result.command;
    }
    env = { ...env, ...sanitizeEnvPatch(result.env) };
    if (result.pathPrepend && result.pathPrepend.length > 0) {
      env = prependPathDirs(env, result.pathPrepend, pluginId);
    }
    if (result.decorateSpawn === true) {
      decorateSpawn = true;
    }
  }

  return {
    decorateSpawn,
    launch: {
      ...launch,
      ...(command ? { command } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}

export async function wrapAndRegisterLaunch(
  launch: ResolvedTerminalLaunchOptions,
  register: (next: ResolvedTerminalLaunchOptions) => Promise<string> | string
): Promise<string> {
  const wrapped = await applyWrapT1(launch);
  const launchId = await register(wrapped.launch);
  rememberDecorateSpawnFlag(launchId, wrapped.decorateSpawn);
  return launchId;
}

async function firstDecorateSpawnEnv(
  handlers: ReadonlyArray<{ handler: LaunchWrapHandler; pluginId: string }>,
  input: {
    agentId: AgentKind;
    env: Record<string, string>;
    panelId: string;
    windowId: string;
  }
): Promise<{ env: Record<string, string>; keys: string[] }> {
  let accepted: LaunchSpawnResult["env"];
  let acceptedKeys: string[] = [];
  let acceptedPluginId: string | undefined;
  for (const { handler, pluginId } of handlers) {
    let result: LaunchSpawnResult;
    try {
      result = await handler.decorateSpawn({
        agentId: input.agentId,
        env: { ...input.env },
        panelId: input.panelId,
        windowId: input.windowId,
      });
    } catch (error) {
      log.warn("launch wrap decorateSpawn failed", {
        error: error instanceof Error ? error.message : String(error),
        pluginId,
      });
      continue;
    }
    const sanitized = sanitizeEnvPatch(result.env);
    if (Object.keys(sanitized).length === 0) {
      continue;
    }
    if (accepted) {
      log.warn("launch wrap decorateSpawn ignored extra env", { pluginId });
      continue;
    }
    accepted = sanitized;
    acceptedKeys = Object.keys(result.env ?? {});
    acceptedPluginId = pluginId;
  }
  if (!(accepted && acceptedPluginId)) {
    return { env: {}, keys: [] };
  }
  return { env: accepted, keys: acceptedKeys };
}

export async function applyDecorateSpawnT2(input: {
  agentId: AgentKind;
  launch: ResolvedTerminalLaunchOptions;
  panelId: string;
  windowId: string;
}): Promise<{
  ephemeralKeys: string[];
  launch: ResolvedTerminalLaunchOptions;
}> {
  const handlers = listLaunchWrapHandlers();
  const env = { ...(input.launch.env ?? {}) };
  const patch = await firstDecorateSpawnEnv(handlers, {
    agentId: input.agentId,
    env,
    panelId: input.panelId,
    windowId: input.windowId,
  });
  if (Object.keys(patch.env).length === 0) {
    return { ephemeralKeys: patch.keys, launch: input.launch };
  }
  return {
    ephemeralKeys: patch.keys,
    launch: {
      ...input.launch,
      env: { ...env, ...patch.env },
    },
  };
}

export function resolveLiveControlSocketPath(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync
): string | undefined {
  const socketPath = resolveLocalControlSocketPath(userDataDir, platform);
  if (!socketPath) {
    return;
  }
  if (platform === "win32") {
    return socketPath;
  }
  return exists(socketPath) ? socketPath : undefined;
}

export function readUserDataControlSocketPath(
  getUserDataDir: () => string
): string | undefined {
  try {
    return resolveLiveControlSocketPath(getUserDataDir());
  } catch {
    return;
  }
}

export async function applyLaunchWrapForCreate(input: {
  agentId: AgentKind | undefined;
  controlSocketPath?: string | undefined;
  hookEnv: Record<string, string>;
  launch: ResolvedTerminalLaunchOptions | undefined;
  panelId: string;
  userData?: string | undefined;
  windowId: string;
}): Promise<ResolvedTerminalLaunchOptions> {
  let launch = input.launch;
  let decorateSpawn = false;
  if (input.agentId) {
    const t1 = await applyWrapT1({
      ...(launch ?? {}),
      agentId: input.agentId,
    });
    launch = t1.launch;
    decorateSpawn = t1.decorateSpawn;
  }
  let withIdentity = withPanelStatusEnv(
    launch,
    input.panelId,
    input.windowId,
    input.hookEnv,
    input.controlSocketPath
  );
  if (input.agentId && input.userData) {
    withIdentity = {
      ...withIdentity,
      env: mergeSystemSkillExtraRootEnv({
        agentKind: input.agentId,
        env: { ...(withIdentity.env ?? {}) },
        userData: input.userData,
      }),
    };
  }
  if (!(input.agentId && decorateSpawn)) {
    return withIdentity;
  }
  const t2 = await applyDecorateSpawnT2({
    agentId: input.agentId,
    launch: withIdentity,
    panelId: input.panelId,
    windowId: input.windowId,
  });
  return t2.launch;
}
