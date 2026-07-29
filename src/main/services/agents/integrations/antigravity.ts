import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EXTRACT_STDIN_META_SCRIPT_NAME,
  PIER_HOOK_COMMAND_GENERATION,
} from "../agent-hooks-install.ts";
import { stdinIdentityExtractionLines } from "./hook-stdin-commands.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  maxPierHookGenerationInSettings,
  PIER_AGENT_HOOKS_DIR_MARK,
  pierHookCommandGeneration,
  pierHookCommandV3,
  pierHookCommandV3WithStdin,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

/**
 * Antigravity hook 事件 → pier 事件名。
 *
 * 信源：当前官方 hooks 文档。文档明确给出配置路径、命名 hook 结构、
 * 事件、timeout 单位和 Stop 载荷；生产事故说明仅用于补充解释为何不安装
 * 会参与权限判定的 PreToolUse。
 *
 * 配置文件：~/.gemini/config/hooks.json（Antigravity
 * 基于 Gemini 衍生，沿用 Gemini 的 hooks 配置路径；loomdesk 参考实现把它
 * 当作未注册模块 / 使用 ~/.antigravity/settings.json 是错的，此前版本沿
 * 用了 loomdesk 的错误路径，现已改正）。
 *
 * schema 形状：hooks.json 顶层是命名 hook 定义，事件直接位于命名定义
 * 下；非工具事件的值是 handler 数组，不使用 Claude 的 matcher/hooks 嵌套。
 * handler 的 timeout 单位是秒，Pier 显式写 5。
 *
 * 官方核心检查点：
 * - PreInvocation：调用前的活动信号（映射 processing，不能证明用户提交）。
 * - Stop：仅 `fullyIdle=true` 能映射 advisory Stop；`error` 映射 error，
 *   其余分支仍是 processing，避免未真正空闲时误报 ready。
 * - PostInvocation：一轮 agent 交互结束——与 Stop 语义高度重叠（都在回合
 *   结束时触发），为避免同一时刻产生两条 Stop 事件（重复上报/状态抖动），
 *   保守选择不安装 PostInvocation，仅在此注释说明其存在与语义，待未来
 *   有更明确的信源区分二者触发时机差异后再考虑启用。
 *
 * !!! 安全红线（真实且危险）!!!
 * 绝对不要给 Antigravity 装 `PreToolUse` 这个原生事件键。cmux#4768 记录
 * 了一起生产事故：`PreToolUse` 在 Antigravity（及其上游 Gemini 系）里是
 * 阻塞式权限判定 hook——hook 的返回值决定工具调用是否被放行。Pier 的 hook
 * 是纯观测型、尾部 `|| true`，但只要挂在这个键上就会在用户的工具调用链路
 * 里插入一个额外的阻塞点，轻则拖慢、重则在网络异常时卡死工具执行。我们
 * 当前官方载荷也不足以构成可关联的工具生命周期，因而不声明工具能力。
 * 任何后续修改这份 spec 的人，都不允许新增一条
 * `nativeEvent: "PreToolUse"` 的映射。
 *
 * 删除 Notification→PermissionRequest：无确证信源支撑这条映射的存在，
 * 已移除。
 */
const antigravityConfigDir = () => join(homedir(), ".gemini", "config");
const antigravityConfigPath = () => join(antigravityConfigDir(), "hooks.json");
const PIER_ANTIGRAVITY_HOOK_NAME = "pier-agent-status";
const ANTIGRAVITY_HOOK_TIMEOUT_SECONDS = 5;

function extractStoredNativeState(
  field: "error" | "terminationReason"
): string {
  const extractMeta = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/${EXTRACT_STDIN_META_SCRIPT_NAME}`;
  return [
    `_pier_extracted_fields=$(printf '%s' "$_pier_payload" | { if [ -x "${extractMeta}" ]; then "${extractMeta}" --shell-fields "" "${field}" "" "" "" "" "" "" ""; fi; } 2>/dev/null || true)`,
    'eval "$_pier_extracted_fields" 2>/dev/null || true',
  ].join("; ");
}

function antigravityStopEmit(
  event: "Stop" | "error" | "processing",
  nativeEvent: "Stop.active" | "Stop.error" | "Stop.fullyIdle"
): string {
  return pierHookCommandV3({
    agentId: "antigravity",
    event,
    metadataBase64: "$_pier_metadata_b64",
    nativeEvent,
    nativeState: "$_pier_native_state",
    sessionId: "$_pier_session_id",
    transcriptPath: "$_pier_transcript_path",
    turnId: "$_pier_turn_id",
  });
}

/**
 * Antigravity 的 Stop 是带分支的状态快照，不是无条件回合完成：
 * error 优先；只有 fullyIdle=true 才结算；其余保持 processing。
 */
function antigravityStopCommand(): string {
  const emit = [
    ...stdinIdentityExtractionLines({ nativeStateFields: ["fullyIdle"] }),
    '_pier_fully_idle="$_pier_native_state"',
    extractStoredNativeState("error"),
    '_pier_error="$_pier_native_state"',
    extractStoredNativeState("terminationReason"),
    '_pier_termination_reason="$_pier_native_state"',
    `if [ -n "$_pier_error" ]; then _pier_native_state="$_pier_error"; ${antigravityStopEmit(
      "error",
      "Stop.error"
    )}; elif [ "$_pier_fully_idle" = "true" ]; then _pier_native_state="$_pier_termination_reason"; ${antigravityStopEmit(
      "Stop",
      "Stop.fullyIdle"
    )}; else _pier_native_state="$_pier_termination_reason"; ${antigravityStopEmit(
      "processing",
      "Stop.active"
    )}; fi`,
  ].join("; ");
  return `${emit}; printf '%s\\n' '{"decision":""}'`;
}

interface AntigravityHookHandler {
  command: string;
  timeout: number;
  type: "command";
}

type AntigravityNamedHook = Record<
  "PreInvocation" | "Stop",
  AntigravityHookHandler[]
>;

function antigravityNamedHook(): AntigravityNamedHook {
  return {
    PreInvocation: [
      {
        command: `${pierHookCommandV3WithStdin({
          agentId: "antigravity",
          event: "processing",
          nativeEvent: "PreInvocation",
        })}; printf '%s\\n' '{}'`,
        timeout: ANTIGRAVITY_HOOK_TIMEOUT_SECONDS,
        type: "command",
      },
    ],
    Stop: [
      {
        command: antigravityStopCommand(),
        timeout: ANTIGRAVITY_HOOK_TIMEOUT_SECONDS,
        type: "command",
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 清理早期错误写入的 Claude 嵌套结构。按 command 粒度删除 Pier 条目，
 * 即使用户命令与旧 Pier 命令位于同一 matcher，也不会丢失用户命令。
 */
function withoutLegacyNestedPierHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(settings.hooks)) {
    return settings;
  }
  const hooks: Record<string, unknown> = {};
  let changed = false;
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) {
      hooks[event] = entries;
      continue;
    }
    const keptEntries: unknown[] = [];
    for (const entry of entries) {
      if (!isRecord(entry)) {
        keptEntries.push(entry);
        continue;
      }
      if (
        typeof entry.command === "string" &&
        isPierHookCommand(entry.command)
      ) {
        changed = true;
        continue;
      }
      if (!Array.isArray(entry.hooks)) {
        keptEntries.push(entry);
        continue;
      }
      const nested = entry.hooks.filter(
        (hook) =>
          !(
            isRecord(hook) &&
            typeof hook.command === "string" &&
            isPierHookCommand(hook.command)
          )
      );
      if (nested.length === entry.hooks.length) {
        keptEntries.push(entry);
        continue;
      }
      changed = true;
      if (nested.length > 0) {
        keptEntries.push({ ...entry, hooks: nested });
      }
    }
    if (keptEntries.length > 0) {
      hooks[event] = keptEntries;
    }
  }
  if (!changed) {
    return settings;
  }
  if (Object.keys(hooks).length === 0) {
    const { hooks: _removed, ...rest } = settings;
    return rest;
  }
  return { ...settings, hooks };
}

function withoutPierNamedHook(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const definition = settings[PIER_ANTIGRAVITY_HOOK_NAME];
  if (!isRecord(definition)) {
    return settings;
  }
  const kept: Record<string, unknown> = {};
  let changed = false;
  for (const [event, handlers] of Object.entries(definition)) {
    if (!Array.isArray(handlers)) {
      kept[event] = handlers;
      continue;
    }
    const keptHandlers = handlers.filter(
      (handler) =>
        !(
          isRecord(handler) &&
          typeof handler.command === "string" &&
          isPierHookCommand(handler.command)
        )
    );
    if (keptHandlers.length !== handlers.length) {
      changed = true;
    }
    if (keptHandlers.length > 0) {
      kept[event] = keptHandlers;
    }
  }
  if (!changed) {
    return settings;
  }
  const hasUserContent = Object.keys(kept).some((key) => key !== "enabled");
  if (hasUserContent) {
    return { ...settings, [PIER_ANTIGRAVITY_HOOK_NAME]: kept };
  }
  const { [PIER_ANTIGRAVITY_HOOK_NAME]: _removed, ...rest } = settings;
  return rest;
}

function maxPierNamedHookGeneration(settings: Record<string, unknown>): number {
  const definition = settings[PIER_ANTIGRAVITY_HOOK_NAME];
  if (!isRecord(definition)) {
    return 0;
  }
  let max = 0;
  for (const handlers of Object.values(definition)) {
    if (!Array.isArray(handlers)) {
      continue;
    }
    for (const handler of handlers) {
      if (
        isRecord(handler) &&
        typeof handler.command === "string" &&
        isPierHookCommand(handler.command)
      ) {
        max = Math.max(max, pierHookCommandGeneration(handler.command));
      }
    }
  }
  return max;
}

export const antigravityIntegration: AgentHookIntegration = {
  detect: () =>
    existsSync(antigravityConfigDir()) ||
    existsSync(join(homedir(), ".gemini", "antigravity-cli")) ||
    commandExistsOnPath("agy"),
  id: "antigravity",
  install: () => installAntigravityHooks(),
  runtime: {
    emittedMappings: [
      { nativeEvent: "PreInvocation", pierEvent: "processing" },
      { nativeEvent: "Stop.error", pierEvent: "error" },
      { nativeEvent: "Stop.fullyIdle", pierEvent: "Stop" },
      { nativeEvent: "Stop.active", pierEvent: "processing" },
    ],
    stopAuthority: "advisory",
  },
  uninstall: () => uninstallAntigravityHooks(),
};

export function withPierAntigravityHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  if (
    Math.max(
      maxPierHookGenerationInSettings(settings),
      maxPierNamedHookGeneration(settings)
    ) > PIER_HOOK_COMMAND_GENERATION
  ) {
    return settings;
  }
  const cleaned = withoutPierNamedHook(withoutLegacyNestedPierHooks(settings));
  if (cleaned[PIER_ANTIGRAVITY_HOOK_NAME] !== undefined) {
    return cleaned;
  }
  return {
    ...cleaned,
    [PIER_ANTIGRAVITY_HOOK_NAME]: antigravityNamedHook(),
  };
}

export function withoutPierAntigravityHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNamedHook(withoutLegacyNestedPierHooks(settings));
}

export async function installAntigravityHooks(
  settingsPath: string = antigravityConfigPath()
): Promise<void> {
  await transformJsonConfig(
    settingsPath,
    withPierAntigravityHooks,
    "antigravity"
  );
}

export async function uninstallAntigravityHooks(
  settingsPath: string = antigravityConfigPath()
): Promise<void> {
  await transformJsonConfig(
    settingsPath,
    withoutPierAntigravityHooks,
    "antigravity"
  );
}
