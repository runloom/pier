import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  pierBlockMarkers,
  pierHookCommand,
  removePierTextBlock,
  upsertPierTextBlock,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "mistral-vibe";

/**
 * Mistral Vibe hook（Experimental）事件 → pier 事件名。
 * 依据官方 README github.com/mistralai/mistral-vibe（Hooks 章节）：
 * - 配置路径 `~/.vibe/hooks.toml`（用户级；项目级 `.vibe/hooks.toml` 优先
 *   级更高但 Pier 只管用户级全局文件，与其余集成一致）。
 * - schema 是 TOML `[[hooks]]` 表数组，顶层直接是条目（无嵌套 Event 分组），
 *   字段 `{name, type, match?, command, timeout?, strict?, description?}`；
 *   无解析器场景, 走 shared.ts 的 upsertPierTextBlock marker 块方案
 *   （hooks.toml 是 Vibe 专用 hook 文件, marker 块与用户自定义 [[hooks]]
 *   条目共存不冲突, 无需像 goose 那样检测"顶层键已存在"的合法性风险）。
 * - 官方仅 3 个 hook type：
 *     post_agent_turn → Stop  （回合结束, 无待处理工具调用）
 *     before_tool     → ToolStart
 *     after_tool      → ToolComplete
 *   无会话级事件（无 SessionStart/SessionEnd 等价物）——因此
 *   capability 为 "coarse"。
 * - **必须同时在 `~/.vibe/config.toml` 设 enable_experimental_hooks = true
 *   （或环境变量 VIBE_ENABLE_EXPERIMENTAL_HOOKS=1）hooks.toml 才生效**。
 *   改配置文件开实验开关的动作对用户过于侵入（且该开关可能影响用户自己
 *   其他 hook 条目的启用状态), 因此 Pier 不代为设置——仅在安装时检测
 *   config.toml 是否已开启, 未开启则 console.warn 提示（hooks.toml 本身
 *   安装无害, 照常写入）, 由用户自行决定是否开启实验开关。
 * - Experimental 特性, 官方已有一次 breaking change 历史——schema 未来
 *   可能变化, 需要留意上游更新。
 * - matcher 字段名是 `match`（不是 `matcher`），且是 fnmatch glob 或
 *   `re:` 前缀正则（不同于 aug/droid 家族的纯正则 matcher）；工具类事件
 *   省略 match 表示匹配全部工具（同 kimi 的省略即全匹配语义）。
 */
const VIBE_HOOK_EVENTS: ReadonlyArray<{
  nativeType: string;
  pierEvent: string;
}> = [
  { nativeType: "before_tool", pierEvent: "ToolStart" },
  { nativeType: "after_tool", pierEvent: "ToolComplete" },
  { nativeType: "post_agent_turn", pierEvent: "Stop" },
];

const VIBE_HOOK_TIMEOUT_SECONDS = 10;

function vibeHomeDir(): string {
  return join(homedir(), ".vibe");
}

export function vibeHooksConfigPath(): string {
  return join(vibeHomeDir(), "hooks.toml");
}

export function vibeConfigPath(): string {
  return join(vibeHomeDir(), "config.toml");
}

export function vibeDetect(): boolean {
  return existsSync(vibeHomeDir()) || commandExistsOnPath("vibe");
}

/**
 * `~/.vibe/config.toml` 是否已开启实验性 hook 开关（`enable_experimental_hooks
 * = true`，允许行内空白但要求键在行首无缩进）。文件不存在/无法读取时视为
 * 未开启（安装仍照常进行, 仅少一次告警之外的信息量, 不阻塞）。
 */
const EXPERIMENTAL_HOOKS_FLAG_RE = /^enable_experimental_hooks\s*=\s*true\s*$/m;

export async function vibeExperimentalHooksEnabled(): Promise<boolean> {
  if (process.env.VIBE_ENABLE_EXPERIMENTAL_HOOKS === "1") {
    return true;
  }
  let raw: string;
  try {
    raw = await readFile(vibeConfigPath(), "utf8");
  } catch {
    return false;
  }
  return EXPERIMENTAL_HOOKS_FLAG_RE.test(raw);
}

/**
 * TOML `[[hooks]]` 表数组块。command 值经 JSON.stringify 生成带引号转义的
 * TOML 基本字符串字面量（同 kimi 先例——JSON.stringify 输出对 TOML 基本
 * 字符串同样合法）。`name` 字段用 pier 前缀 + 事件名避免与用户已有 hook
 * 同名冲突。
 */
export function buildVibeHookBlock(): string {
  const entries = VIBE_HOOK_EVENTS.map((event) => {
    const command = pierHookCommand(AGENT_ID, event.pierEvent);
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
  return upsertPierTextBlock(raw, AGENT_ID, buildVibeHookBlock());
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
  if (!(await vibeExperimentalHooksEnabled())) {
    console.warn(
      "[agent-hooks:mistral-vibe] enable_experimental_hooks is not set in ~/.vibe/config.toml " +
        "(or VIBE_ENABLE_EXPERIMENTAL_HOOKS=1) — hooks.toml will be installed but Vibe will " +
        "ignore it until the experimental flag is enabled."
    );
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
  capability: "coarse",
  detect: vibeDetect,
  id: AGENT_ID,
  install: () => installVibeHooks(),
  uninstall: () => uninstallVibeHooks(),
};

/** marker 常量导出（测试断言块边界用）。 */
export const VIBE_BLOCK_MARKERS = pierBlockMarkers(AGENT_ID);
