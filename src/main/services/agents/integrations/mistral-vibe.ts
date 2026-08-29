import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  pierBlockMarkers,
  pierHookCommandV3WithStdin,
  removePierTextBlock,
  upsertPierTextBlockUnlessNewer,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "mistral-vibe";

/**
 * Mistral Vibe 2.21+ 正式 hook 事件 → Pier 事件名。
 * 依据 v2.21.0（0685654a）与 v2.22.0（89350a4）固定发布源码：
 * - 配置路径 `$VIBE_HOME/hooks.toml`，默认 `~/.vibe/hooks.toml`。受信任
 *   项目的 `.vibe/hooks.toml` 优先，但 Pier 只管理用户级全局文件。
 * - schema 是 TOML `[[hooks]]` 表数组，顶层直接是条目（无嵌套 Event 分组），
 *   字段 `{name, type, match?, command, timeout?, strict?, description?}`；
 *   无解析器场景, 走 shared.ts 的 upsertPierTextBlock marker 块方案
 *   （hooks.toml 是 Vibe 专用 hook 文件, marker 块与用户自定义 [[hooks]]
 *   条目共存不冲突, 无需像 goose 那样检测"顶层键已存在"的合法性风险）。
 * - 官方仅 3 个 hook type：
 *     post_agent → Stop（可由 hook 请求重试，故仅是 advisory）
 *     pre_tool   → processing（发生在用户权限确认之前，不能证明工具执行）
 *     post_tool  → ToolComplete（只结算局部工具；失败不得升级全局 error）
 *   无会话级事件（无 SessionStart/SessionEnd 等价物）——因此
 *   状态证据仅覆盖这些事件。
 * - 2.21.0 已移除旧 `enable_experimental_hooks` 门控；2.22.0 的破坏性
 *   配置变化属于 ConfigOrchestrator，不改变 hooks.toml 格式。
 * - `timeout` 由 `asyncio.wait_for(..., timeout=hook.timeout)` 消费，单位为秒。
 * - matcher 字段名是 `match`（不是 `matcher`），且是 fnmatch glob 或
 *   `re:` 前缀正则（不同于 aug/droid 家族的纯正则 matcher）；工具类事件
 *   省略 match 表示匹配全部工具（同 kimi 的省略即全匹配语义）。
 */
const VIBE_HOOK_EVENTS: ReadonlyArray<{
  nativeType: string;
  pierEvent: "processing" | "Stop" | "ToolComplete";
}> = [
  { nativeType: "pre_tool", pierEvent: "processing" },
  { nativeType: "post_tool", pierEvent: "ToolComplete" },
  { nativeType: "post_agent", pierEvent: "Stop" },
];

const VIBE_HOOK_TIMEOUT_SECONDS = 10;

function vibeHomeDir(): string {
  const configured = process.env.VIBE_HOME?.trim();
  if (configured) {
    if (configured === "~") {
      return homedir();
    }
    if (configured.startsWith("~/")) {
      return resolve(homedir(), configured.slice(2));
    }
    return resolve(configured);
  }
  return join(homedir(), ".vibe");
}

export function vibeHooksConfigPath(): string {
  return join(vibeHomeDir(), "hooks.toml");
}

export function vibeDetect(): boolean {
  return existsSync(vibeHomeDir()) || commandExistsOnPath("vibe");
}

/**
 * TOML `[[hooks]]` 表数组块。command 值经 JSON.stringify 生成带引号转义的
 * TOML 基本字符串字面量（同 kimi 先例——JSON.stringify 输出对 TOML 基本
 * 字符串同样合法）。`name` 字段用 pier 前缀 + 事件名避免与用户已有 hook
 * 同名冲突。
 */
export function buildVibeHookBlock(): string {
  const entries = VIBE_HOOK_EVENTS.map((event) => {
    // tool_name/tool_call_id 由提取脚本固定别名组覆盖；历史的单段
    // toolNamePaths/toolUseIdPaths 会被 ≥2 段规则过滤（死配置），已移除。
    const command = pierHookCommandV3WithStdin({
      agentId: AGENT_ID,
      event: event.pierEvent,
      nativeEvent: event.nativeType,
      ...(event.nativeType === "post_tool"
        ? { nativeStateFields: ["tool_status"] }
        : {}),
      parentSessionIdFields: ["parent_session_id"],
    });
    const commandLiteral = JSON.stringify(command);
    const nameLiteral = JSON.stringify(`pier-${event.nativeType}`);
    return (
      "[[hooks]]\n" +
      `name = ${nameLiteral}\n` +
      `type = "${event.nativeType}"\n` +
      `command = ${commandLiteral}\n` +
      `timeout = ${VIBE_HOOK_TIMEOUT_SECONDS}.0`
    );
  });
  return entries.join("\n\n");
}

/** 纯函数：注入/替换 pier marker 块（幂等）。 */
export function withPierVibeHooks(raw: string): string {
  return upsertPierTextBlockUnlessNewer(raw, AGENT_ID, buildVibeHookBlock());
}

/** 纯函数：移除 pier marker 块；无块时原样返回输入引用。 */
export function withoutPierVibeHooks(raw: string): string {
  return removePierTextBlock(raw, AGENT_ID);
}

async function readConfigRaw(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function installVibeHooks(
  configPath: string = vibeHooksConfigPath()
): Promise<void> {
  if (!vibeDetect()) {
    return;
  }
  const raw = await readConfigRaw(configPath);
  const next = withPierVibeHooks(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export async function uninstallVibeHooks(
  configPath: string = vibeHooksConfigPath()
): Promise<void> {
  const raw = await readConfigRaw(configPath);
  const next = withoutPierVibeHooks(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export const mistralVibeIntegration: AgentHookIntegration = {
  detect: vibeDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: VIBE_HOOK_EVENTS.map(({ nativeType, pierEvent }) => ({
      nativeEvent: nativeType,
      pierEvent,
    })),
    stopAuthority: "advisory",
  },
  install: () => installVibeHooks(),
  uninstall: () => uninstallVibeHooks(),
};

/** marker 常量导出（测试断言块边界用）。 */
export const VIBE_BLOCK_MARKERS = pierBlockMarkers(AGENT_ID);
