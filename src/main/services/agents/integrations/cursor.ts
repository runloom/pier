import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isManagedPierHookCommand,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinStatusDispatch,
  type StdinStatusDispatchCase,
  skipHookCommandWhenEnvPresent,
  transformJsonConfig,
  transformPierHooksUnlessNewer,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "cursor";
const TIMEOUT_SECONDS = 10;
/**
 * Grok 默认兼容加载 `~/.cursor/hooks.json`。Cursor 的 Pier 条目在 Grok
 * 会话里必须以 agent=cursor 跳过，否则会双写 FA（grok + cursor）并抬高
 * TUI `[hooks: n/m]` 失败计数。对齐 Claude 的 `skipWhenEnvPresent`。
 */
const CURSOR_SKIP_WHEN_ENV_PRESENT = ["GROK_HOOK_EVENT"] as const;

const configPath = () => join(homedir(), ".cursor", "hooks.json");

type StandardV3Event = Exclude<
  AgentHookEventPayloadV3["event"],
  "InteractionRequested" | "InteractionResolved"
>;

/**
 * Cursor hook 事件 → pier 事件名（cursor.com/docs/hooks 语义为准）。
 *
 * - **不装 `afterAgentResponse`**：它只在"assistant 消息完成"时触发, 回合结束
 *   与 `stop` 几乎同时各起一个 hook 进程写 JSONL, 落盘顺序不保证——曾实测
 *   `stop` 先落盘、`afterAgentResponse` 后落盘, 把候选终态重新拉回
 *   processing, 面板在 TUI 等输入时长挂"思考中"。回合中途的推进已由
 *   tool 系事件覆盖, 该事件对状态零增量、纯竞态源。
 * - **不装 `beforeShellExecution`/`beforeMCPExecution`/`afterShellExecution`/
 *   `afterMCPExecution`**：before* 是执行前闸门, 对自动放行的命令同样触发
 *   （实测每条 shell 都有）且无 approval-resolved 事件——映射
 *   PermissionRequest 会让自动放行的长命令全程假"等待确认"；映射 ToolStart
 *   则因 payload 无 tool_use_id 只能走匿名计数, 拒绝执行时 after* 不触发,
 *   匿名增量无法配对, scope 会滞留"执行工具中"。工具生命周期已由带真实
 *   tool_use_id 的 preToolUse/postToolUse/postToolUseFailure 完整覆盖
 *   （Shell 与 MCP 工具均触发）, 这四个闸门事件对状态零增量。
 * - `stop` 按 payload `status` 在命令内分发（见 CURSOR_STOP_STATUS_CASES）。
 * - **不按 hook 分发 AskQuestion**：上游 preToolUse 不覆盖该工具。问卷
 *   waiting 由 `transcript/cursor-reconciler.ts` 读主会话 jsonl 对账。
 */
export const CURSOR_EVENTS: ReadonlyArray<{
  nativeEvent: string;
  pierEvent: StandardV3Event;
}> = [
  { nativeEvent: "sessionStart", pierEvent: "SessionStart" },
  { nativeEvent: "beforeSubmitPrompt", pierEvent: "PromptSubmit" },
  { nativeEvent: "preToolUse", pierEvent: "ToolStart" },
  { nativeEvent: "postToolUse", pierEvent: "ToolComplete" },
  { nativeEvent: "postToolUseFailure", pierEvent: "ToolComplete" },
  { nativeEvent: "subagentStart", pierEvent: "SubagentStart" },
  { nativeEvent: "subagentStop", pierEvent: "SubagentStop" },
  { nativeEvent: "sessionEnd", pierEvent: "SessionEnd" },
];

/** 按 status 分发的原生事件（不进 CURSOR_EVENTS 的普通模板通道）。 */
const CURSOR_STOP_NATIVE_EVENT = "stop";

/**
 * cursor `stop` payload 自带 `status: "completed" | "aborted" | "error"`
 * （官方 hooks reference）——这是 provider 自己声明的回合终态事实, 直接
 * 分发为可信终态词汇：completed→TurnCompleted（ready, 显示"等待输入"）,
 * aborted→TurnInterrupted（用户中断同样落 ready, 修复 Esc 后状态悬挂）,
 * error→error（回合级失败）。status 缺失/未知值回落 advisory `Stop`
 * （候选终态, 只出品牌图标）——payload 变化时安全退化为旧行为。
 */
export const CURSOR_STOP_STATUS_CASES: readonly StdinStatusDispatchCase[] = [
  { nativeStatus: "completed", pierEvent: "TurnCompleted" },
  { nativeStatus: "aborted", pierEvent: "TurnInterrupted" },
  { nativeStatus: "error", pierEvent: "error" },
];

/**
 * Ev5：cursor 的 FA `error` 经 `stop.status === "error"` 原生可达
 * （provider 自报回合失败, 非 Stop/中断假装）。
 */
export const CURSOR_FA_ERROR_REACHABILITY = "native" as const;

interface CursorHookEntry {
  command: string;
  timeout?: number;
}

function hooksRecord(
  settings: Record<string, unknown>
): Record<string, unknown[]> {
  const hooks = settings.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown[]>) };
  }
  return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCursorInstallShapeSupported(
  settings: Record<string, unknown>
): boolean {
  if (
    Object.hasOwn(settings, "version") &&
    typeof settings.version !== "number"
  ) {
    return false;
  }
  if (!Object.hasOwn(settings, "hooks")) {
    return true;
  }
  const hooks = settings.hooks;
  if (!isPlainObject(hooks)) {
    return false;
  }
  for (const nativeEvent of [
    ...CURSOR_EVENTS.map((event) => event.nativeEvent),
    CURSOR_STOP_NATIVE_EVENT,
  ]) {
    if (
      Object.hasOwn(hooks, nativeEvent) &&
      !Array.isArray(hooks[nativeEvent])
    ) {
      return false;
    }
  }
  return true;
}

function warnUnsupportedCursorShape(): void {
  console.warn(
    `[agent-hooks:${AGENT_ID}] hooks/version has unrecognized structure, skip install`
  );
}

function isPierCursorEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  // emit 规范 + 遗留 PIER_AGENT_HOOK_PORT curl 一并视作 Pier 所有权。
  return isManagedPierHookCommand((entry as CursorHookEntry).command);
}

function wrapCursorPierCommand(command: string): string {
  return skipHookCommandWhenEnvPresent(command, CURSOR_SKIP_WHEN_ENV_PRESENT);
}

function cursorHookCommand(
  nativeEvent: string,
  event: StandardV3Event
): string {
  const subagent =
    nativeEvent === "subagentStart" || nativeEvent === "subagentStop";
  return wrapCursorPierCommand(
    pierHookCommandV3WithStdin({
      ...(subagent
        ? {
            actorHintFromAgentId: true,
            agentInstanceIdFields: ["subagent_id", "subagentId"],
            agentTypeFields: ["subagent_type", "subagentType"],
            parentSessionIdFields: [
              "parent_conversation_id",
              "parentConversationId",
              "conversation_id",
              "conversationId",
            ],
            sessionIdAsParent: true,
            suppressTurnId: true,
          }
        : {}),
      agentId: AGENT_ID,
      event,
      nativeEvent,
      turnIdFields: ["generation_id", "generationId"],
    })
  );
}

/**
 * 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。command 直接在
 * 定义对象上（非嵌套 hooks 数组，与 claude/openclaude 的 schema 不同）。
 * 顶层 version 保留已有值，缺失则写 1。
 */
export function withPierCursorHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  if (!isCursorInstallShapeSupported(settings)) {
    warnUnsupportedCursorShape();
    return settings;
  }
  const hooks = hooksRecord(settings);
  const install = (nativeEvent: string, command: string): void => {
    const current = hooks[nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const kept = existing.filter((entry) => !isPierCursorEntry(entry));
    const pierEntry: CursorHookEntry = { command, timeout: TIMEOUT_SECONDS };
    hooks[nativeEvent] = [...kept, pierEntry];
  };
  for (const event of CURSOR_EVENTS) {
    install(
      event.nativeEvent,
      cursorHookCommand(event.nativeEvent, event.pierEvent)
    );
  }
  install(
    CURSOR_STOP_NATIVE_EVENT,
    wrapCursorPierCommand(
      pierHookCommandV3WithStdinStatusDispatch({
        agentId: AGENT_ID,
        cases: CURSOR_STOP_STATUS_CASES,
        fallbackPierEvent: "Stop",
        nativeEvent: CURSOR_STOP_NATIVE_EVENT,
        turnIdFields: ["generation_id", "generationId"],
      })
    )
  );
  return {
    ...settings,
    hooks,
    version: typeof settings.version === "number" ? settings.version : 1,
  };
}

/**
 * 纯函数：剔除全部 pier hook 条目，空事件键一并删除。无 pier 条目时
 * 原样返回输入引用（卸载对齐防护）。
 */
export function withoutPierCursorHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierCursorEntry(entry));
    if (kept.length === entries.length) {
      continue;
    }
    changed = true;
    if (kept.length > 0) {
      hooks[key] = kept;
    } else {
      delete hooks[key];
    }
  }
  if (!changed) {
    return settings;
  }
  return { ...settings, hooks };
}

export async function installCursorHooks(
  settingsPath: string = configPath()
): Promise<void> {
  // 先剔全部 pier 条目再按当前表写入（对齐 createNestedJsonIntegration）：
  // 覆盖「上一版装过但本版已移出」的遗留——如 afterAgentResponse。
  // 若磁盘已有更高 pier-hook-gen，跳过以免旧 worktree 降级命名提取。
  await transformJsonConfig(
    settingsPath,
    (s) => {
      if (!isCursorInstallShapeSupported(s)) {
        warnUnsupportedCursorShape();
        return s;
      }
      return transformPierHooksUnlessNewer(s, (current) =>
        withPierCursorHooks(withoutPierCursorHooks(current))
      );
    },
    AGENT_ID
  );
}

export async function uninstallCursorHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCursorHooks, AGENT_ID);
}

export const cursorIntegration: AgentHookIntegration = {
  detect: () => existsSync(configPath()) || commandExistsOnPath("cursor-agent"),
  id: AGENT_ID,
  // 正常回合终态经 stop.status 分发为 TurnCompleted/TurnInterrupted/error
  // （可信终态, 不经 Stop 通道）；advisory 只约束 status 缺失/未知时的
  // 回落 `Stop`——旧版 cursor CLI 或 payload 变更时退化为候选终态。
  runtime: {
    emittedMappings: [
      ...CURSOR_EVENTS,
      ...CURSOR_STOP_STATUS_CASES.map(({ nativeStatus, pierEvent }) => ({
        nativeEvent: `stop.status=${nativeStatus}`,
        pierEvent,
      })),
    ],
    stopAuthority: "advisory",
  },
  install: () => installCursorHooks(),
  uninstall: () => uninstallCursorHooks(),
};
