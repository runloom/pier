import { join } from "node:path";
import type {
  LaunchSpawnInput,
  LaunchSpawnResult,
  LaunchWrapInput,
  LaunchWrapResult,
} from "@pier/plugin-api/main";
import { type ensureOmoShadow, OMO_PORT } from "./omo-shadow.ts";
import {
  bindLeaderSession,
  loadSessionMap,
  paneIdForPanel,
  parseTmuxValue,
} from "./session-map.ts";
import {
  ADAPTER_CLAUDE_KEY,
  ADAPTER_ENABLED_KEY,
  ADAPTER_OPENCODE_KEY,
  PRESET_CLAUDE_TEAMS_KEY,
  PRESET_OPENCODE_OMO_KEY,
} from "./settings-keys.ts";

const ONE_SHOT_RE = /(^|\s)(-p|--print)(\s|$)/;

export type AdapterConfigReader = (key: string) => unknown;

/**
 * 即时偏好：每次 wrap 现读现判（改了只影响之后新开的会话）。
 * 总开关关闭或对应智能体开关关闭 → 不桥接；未声明的智能体不受
 * 分开关约束（仅 claude / opencode 提供细粒度键）。
 */
export function adapterDisabledFor(
  agentId: string,
  getConfig: AdapterConfigReader
): boolean {
  if (getConfig(ADAPTER_ENABLED_KEY) === false) {
    return true;
  }
  if (agentId === "claude" && getConfig(ADAPTER_CLAUDE_KEY) === false) {
    return true;
  }
  if (agentId === "opencode" && getConfig(ADAPTER_OPENCODE_KEY) === false) {
    return true;
  }
  return false;
}

export interface WrapLogger {
  warn(message: string, meta?: unknown): void;
}

export interface WrapOptions {
  ensureOmoShadow?: typeof ensureOmoShadow;
  getConfig?: AdapterConfigReader;
  logger?: WrapLogger;
  workDir: string;
}

export function wrapLaunch(
  input: LaunchWrapInput,
  options: WrapOptions
): LaunchWrapResult {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return {};
  }
  if (!input.command.trim()) {
    return {};
  }
  if (ONE_SHOT_RE.test(input.command)) {
    return {};
  }
  const getConfig = options.getConfig;
  if (getConfig && adapterDisabledFor(agentId, getConfig)) {
    return {};
  }

  // T1：pathPrepend + decorateSpawn（金标准 §7.4）。
  const result: LaunchWrapResult = {
    decorateSpawn: true,
    pathPrepend: [join(options.workDir, "bin")],
  };

  // 预设糖（默认关，仅在适配器已激活时追加；失败不阻断启动，降级为 T2）。
  const env: Record<string, string> = {};
  let command = input.command;
  if (getConfig?.(PRESET_CLAUDE_TEAMS_KEY) === true && agentId === "claude") {
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
    if (!/--teammate-mode(\s|=|$)/u.test(command)) {
      command += " --teammate-mode auto";
    }
  }
  if (
    getConfig?.(PRESET_OPENCODE_OMO_KEY) === true &&
    agentId === "opencode" &&
    options.ensureOmoShadow
  ) {
    const shadow = options.ensureOmoShadow(options.workDir);
    if (shadow.ok) {
      env.OPENCODE_CONFIG_DIR = shadow.dir;
      env.OPENCODE_PORT = String(OMO_PORT);
      if (!/--port(\s|=|$)/u.test(command)) {
        command += ` --port ${OMO_PORT}`;
      }
    } else {
      options.logger?.warn("omo shadow config failed; degrading to adapter", {
        error: shadow.error,
      });
    }
  }

  if (Object.keys(env).length > 0) {
    result.env = env;
  }
  if (command !== input.command) {
    result.command = command;
  }
  return result;
}

export function decorateLaunchSpawn(
  input: LaunchSpawnInput,
  options: { workDir: string }
): LaunchSpawnResult {
  const inherited = input.env.TMUX;
  if (inherited) {
    const parsed = parseTmuxValue(inherited);
    if (parsed) {
      const map = loadSessionMap(parsed.workDir, parsed.sessionId);
      if (map) {
        const paneId =
          paneIdForPanel(map, input.panelId) ?? input.env.TMUX_PANE ?? "%0";
        return {
          env: {
            TMUX: inherited,
            TMUX_PANE: paneId,
          },
        };
      }
    }
  }
  const bound = bindLeaderSession({
    panelId: input.panelId,
    windowId: input.windowId,
    workDir: options.workDir,
  });
  return {
    env: {
      TMUX: bound.tmuxValue,
      TMUX_PANE: "%0",
    },
  };
}
