import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
  preflightPierNestedHooksInstall,
  transformJsonConfig,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

type StandardV3Event = Exclude<
  AgentHookEventPayloadV3["event"],
  "InteractionRequested" | "InteractionResolved"
>;

function codexStandardCommand(
  event: StandardV3Event,
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({
      actorHintFromAgentId: true,
      agentId,
      event,
      nativeEvent,
    });
}

/**
 * `$CODEX_HOME` 解析（未设置时默认 `~/.codex`）：
 * - 未设置/空 → `~/.codex`。
 * - 以 `~` 开头 → 展开为 homedir()（仅处理开头, shell tilde-expansion 语义）。
 * - 其余（绝对/相对路径）→ 原样使用。
 */
export function codexHomeDir(): string {
  const envHome = process.env.CODEX_HOME;
  if (!envHome) {
    return join(homedir(), ".codex");
  }
  if (envHome === "~") {
    return homedir();
  }
  if (envHome.startsWith("~/") || envHome.startsWith("~\\")) {
    return join(homedir(), envHome.slice(2));
  }
  return envHome;
}

const codexConfigPath = () => join(codexHomeDir(), "hooks.json");

/**
 * Codex hook 事件 → pier 事件名。
 *
 * upstream openai/codex 自 PR#13276 起已原生支持 hooks.json（官方文档
 * developers.openai.com/codex/hooks）。现代 codex 会对未信任的 hook 弹出
 * `/hooks` 信任审查警告（见 issue#21639），这是预期 UX，用户首次触发时
 * 需要在 codex 内确认信任该 hooks.json，不代表集成出错。
 *
 * 当前事件集合以官方 hooks 文档与 openai/codex 源码为准。SessionEnd 已正式
 * 发布。SessionEnd 的 `timeout` 必须 ≤3s（官方 cap；写 5 会 clamp 并警告）。
 * PermissionRequest 输入没有请求 ID，且 hooks 没有用户批准、拒绝或
 * 取消后的结果事件，因此不进入 waiting；具名交互只归 transcript 对账器所有。
 *
 * **补装**：PreCompact/PostCompact 官方源码级存在, 先前版本漏装。
 * 都映射为 processing——避免上下文压缩期间被 30min TTL 误衰减状态。
 *
 * Ev5 / FA `error`：hooks 表无 `StopFailure`（或等价失败 hook）；transcript
 * 对账仅补 `task_complete→TurnCompleted` 与 `turn_aborted→TurnInterrupted`
 * （用户中断 ≠ 出错）。禁止把 `Stop`/`TurnInterrupted` 假装成 `error`。
 * 结论见 `CODEX_FA_ERROR_REACHABILITY`。
 *
 * 所有事件均不写 matcher 字段（工厂默认行为：event.matcher 为
 * undefined 时不写入, 此处所有条目均不传 matcher）。
 */
const CODEX_SPEC: NestedJsonIntegrationSpec = {
  agentId: "codex",
  runtime: { stopAuthority: "advisory" },
  configPath: codexConfigPath,
  // 与 claude/gemini/grok 默认 detect（配置文件是否已存在）不同：
  // codex 的 hooks.json 通常尚不存在, 只要 CODEX_HOME 目录存在即视为
  // 已安装 codex, 应正常安装（seed）——readJsonConfig 对缺失文件返回
  // {}, install 会正常创建该文件。
  detect: () => existsSync(codexHomeDir()),
  events: [
    {
      buildCommand: codexStandardCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: codexStandardCommand("PromptSubmit", "UserPromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: codexStandardCommand("ToolStart", "PreToolUse"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: codexStandardCommand("ToolComplete", "PostToolUse"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: codexStandardCommand("processing", "PreCompact"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: codexStandardCommand("processing", "PostCompact"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: codexStandardCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: codexStandardCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: codexStandardCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: codexStandardCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
      // Codex SessionEnd：官方默认 ~1s、上限 3s；写 >3 会 clamp 并打警告。
      // 见 developers.openai.com/codex/hooks（SessionEnd timeout cap）。
      timeout: 3,
    },
  ],
};

export const CODEX_HOOK_EVENTS = CODEX_SPEC.events;

/**
 * Ev5 诚实结论：codex hooks + transcript 对账均无原生回合失败 → FA `error`。
 * 证据：发布版 hooks 无 StopFailure；对账只产 TurnCompleted/TurnInterrupted。
 */
export const CODEX_FA_ERROR_REACHABILITY = "unsupported" as const;

export const codexIntegration = createNestedJsonIntegration(CODEX_SPEC);

/** 兼容导出（与 claude.ts 一致的模式；语义与工厂一致）。 */
export function withPierCodexHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withPierNestedHooks(settings, CODEX_SPEC);
}

export function withoutPierCodexHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(settings);
}

export async function installCodexHooks(
  settingsPath: string = CODEX_SPEC.configPath()
): Promise<void> {
  // 先剔全部 pier 条目再按当前 spec 装, 与工厂 createNestedJsonIntegration
  // 保持一致——清理上一版 spec 装过但本版已移出的遗留。
  await transformJsonConfig(
    settingsPath,
    (s) => {
      if (!preflightPierNestedHooksInstall(s, CODEX_SPEC)) {
        return s;
      }
      return withPierCodexHooks(withoutPierCodexHooks(s));
    },
    "codex"
  );
}

export async function uninstallCodexHooks(
  settingsPath: string = CODEX_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCodexHooks, "codex");
}
