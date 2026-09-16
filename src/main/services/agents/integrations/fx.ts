import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "fx";

/**
 * fx 状态集成——Herdr socket 通道，无配置文件可写。
 *
 * 上游事实（vercel-labs/fx@e45d780933bfb42ae376aee54a49bd3ebe81f04d）：
 * fx 的 hooks 是进程内 handler 注册（`src/core/hooks/`：PreToolUse / Stop /
 * PostTurnEnd / AttentionRequired），`~/.fx/settings.json` 无外部 hook 配置
 * 面（settings_catalog 零 hook 引用）。唯一外部状态面是 Herdr 生命周期
 * 上报：`HERDR_SOCKET_PATH` + `HERDR_PANE_ID` 同时存在时 fx 自动经 Unix
 * socket 上报 idle/working/blocked（`src/builtins/hooks/herdr.zig` +
 * `src/builtins/hooks.zig`；ask one-shot 无 Herdr 引用）。
 *
 * 因此本集成不写任何配置文件：状态面由 Pier 在 PTY 注入
 * HERDR_SOCKET_PATH/HERDR_PANE_ID 后、fx 自动上报驱动；install/uninstall
 * 是 no-op（幂等、无落盘）。detect 只判断 fx 是否可用。
 */

export function fxDetect(): boolean {
  return existsSync(join(homedir(), ".fx")) || commandExistsOnPath("fx");
}

async function noop(): Promise<void> {
  // 无配置文件可写：Herdr 通道由 PTY env 注入驱动，不落盘。
}

const FX_HERDR_MAPPINGS = [
  { nativeEvent: "herdr.working", pierEvent: "processing" },
  { nativeEvent: "herdr.idle", pierEvent: "ActivityIdle" },
  { nativeEvent: "herdr.blocked.permission", pierEvent: "processing" },
  { nativeEvent: "herdr.blocked.question", pierEvent: "processing" },
  { nativeEvent: "herdr.blocked.recovery", pierEvent: "processing" },
] as const;

export const FX_HERDR_NATIVE_EVENTS = FX_HERDR_MAPPINGS;

export const fxIntegration: AgentHookIntegration = {
  runtime: {
    emittedMappings: [...FX_HERDR_MAPPINGS],
    stopAuthority: "none",
  },
  detect: fxDetect,
  id: AGENT_ID,
  install: noop,
  uninstall: noop,
};
