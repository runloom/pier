import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../hooks-install.ts";
import {
  isManagedPierHookCommand,
  isPierHookCommand,
  pierHookCommandGeneration,
  skipHookCommandWhenEnvPresent,
} from "./hooks/command-core.ts";
import { pierHookCommandWithStdinSessionId } from "./hooks/stdin-commands.ts";
import type { AgentHookIntegration, AgentRuntimeSemantics } from "./types.ts";

export { commandExistsOnPath } from "./command-path.ts";
// 兼容再导出：历史集成与测试从 shared 取 hook 命令原语。
export {
  isLegacyPierHttpHookCommand,
  isManagedPierHookCommand,
  isPierHookCommand,
  PIER_AGENT_HOOKS_DIR_MARK,
  PIER_HOOK_GEN_MARK,
  type PierHookCommandV3Spec,
  pierHookCommand,
  pierHookCommandGeneration,
  pierHookCommandV3,
  pierHookCommandV3ShellDispatched,
  skipHookCommandWhenEnvPresent,
} from "./hooks/command-core.ts";
export {
  type PierHookCommandV3WithStdinSpec,
  pierClaudeUserPromptSubmitCommand,
  pierClaudeUserPromptSubmitCommandV3,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinOutcomeDispatch,
  pierHookCommandV3WithStdinStatusDispatch,
  pierHookCommandV3WithStdinValueDispatch,
  pierHookCommandWithStdinSessionId,
  pierHookCommandWithStdinStatusDispatch,
  type StdinInteractionOutcomeDispatchCase,
  type StdinStatusDispatchCase,
  type StdinV3StatusDispatchSpec,
  type StdinV3ValueDispatchSpec,
  type StdinValueDispatchCase,
} from "./hooks/stdin-commands.ts";
export {
  type InteractiveToolResolveOutcome,
  pierHookCommandV3WithStdinInteractiveToolResolve,
  pierHookCommandV3WithStdinInteractiveToolStart,
  pierHookCommandV3WithStdinPermissionAcceptedThenToolStart,
  type StdinInteractiveToolDispatchSpec,
  type StdinInteractiveToolResolveSpec,
} from "./hooks/stdin-sequences.ts";
export type { InteractiveBlockingToolCase } from "./interactive-blocking-tools.ts";
export {
  type InteractiveBlockingToolLifecycleOptions,
  interactiveBlockingToolLifecycleEvents,
} from "./interactive-tool-lifecycle.ts";
export {
  pierBlockMarkers,
  pierTextBlockGeneration,
  removePierTextBlock,
  upsertPierTextBlock,
  upsertPierTextBlockUnlessNewer,
} from "./text-block.ts";

/** 扫描 settings.hooks 下全部 pier command 的最大世代。 */
export function maxPierHookGenerationInSettings(
  settings: Record<string, unknown>
): number {
  let max = 0;
  const visitCommand = (command: unknown): void => {
    if (typeof command !== "string" || !isPierHookCommand(command)) {
      return;
    }
    max = Math.max(max, pierHookCommandGeneration(command));
  };
  const hooks = settings.hooks;
  if (!(hooks && typeof hooks === "object" && !Array.isArray(hooks))) {
    return max;
  }
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!(entry && typeof entry === "object")) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      visitCommand(record.command);
      const nested = record.hooks;
      if (!Array.isArray(nested)) {
        continue;
      }
      for (const hook of nested) {
        if (hook && typeof hook === "object") {
          visitCommand((hook as { command?: unknown }).command);
        }
      }
    }
  }
  return max;
}

/**
 * 若磁盘上已有更高世代的 pier hook，则保留原配置（防止旧 worktree 降级覆盖）。
 * 否则执行 rewrite。
 */
export function transformPierHooksUnlessNewer(
  settings: Record<string, unknown>,
  rewrite: (s: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  if (
    maxPierHookGenerationInSettings(settings) > PIER_HOOK_COMMAND_GENERATION
  ) {
    return settings;
  }
  return rewrite(settings);
}

/**
 * 读 JSON 配置：文件不存在 → {}（从空开始）；解析失败/非对象 → null
 * （已损坏, 调用方必须放弃写入, 不得破坏用户文件）。
 */
export async function readJsonConfig(
  path: string
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function atomicWriteFile(
  path: string,
  data: string
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.pier-tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}

/**
 * JSON 配置变换落盘：损坏跳过并告警；语义无变化不落盘（保护用户文件既有
 * 格式, 幂等重装/空卸载零副作用）。
 */
export async function transformJsonConfig(
  path: string,
  transform: (s: Record<string, unknown>) => Record<string, unknown>,
  label: string
): Promise<void> {
  const settings = await readJsonConfig(path);
  if (settings === null) {
    console.warn(`[agent-hooks:${label}] config unparsable, skip:`, path);
    return;
  }
  const next = transform(settings);
  if (next === settings || JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Claude-schema（嵌套 hooks: {Event: [{matcher?, hooks:[{type,command}]}]}）
// 工厂：claude 及其 fork 家族（openclaude/devin/droid/command-code/grok/
// qwen-code 等）共用, 差异仅在配置路径/事件表/matcher 约定。
// ---------------------------------------------------------------------------

/** 嵌套 hooks.json 工厂默认 timeout（多数 Claude 系为「秒」）。 */
export const DEFAULT_NESTED_HOOK_TIMEOUT = 5;

interface NestedHookEventBase {
  /** 工具类事件的 matcher；undefined = 不写 matcher 字段。 */
  matcher?: string;
  /** 该 agent 的原生事件名。 */
  nativeEvent: string;
  /** 安装时写入命令的 pier 规范事件名（activityStatusForHookEvent 词汇）。 */
  pierEvent: string;
  /**
   * 写入 hook 配置的 `timeout` 数值。单位由各 agent 运行时解释：
   * Claude / Codex / Grok / Droid 等多为**秒**；Gemini / Qwen / Aug 为**毫秒**。
   * 未设则用 `spec.timeoutSeconds ?? {@link DEFAULT_NESTED_HOOK_TIMEOUT}`。
   */
  timeout?: number;
}

interface NestedSingleHookEventSpec extends NestedHookEventBase {
  /**
   * 覆盖默认 stdin emit 命令（例如 Claude UserPromptSubmit 双写 sessionTitle）。
   * 未设则 `pierHookCommandWithStdinSessionId`。
   */
  buildCommand?: (agentId: AgentKind) => string;
  emittedPierEvents?: never;
}

interface NestedMultiHookEventSpec extends NestedHookEventBase {
  /** 实际发出声明中全部事件的构造器。 */
  buildCommand: (agentId: AgentKind) => string;
  /** buildCommand 实际可发出的完整 Pier 事件集合。 */
  emittedPierEvents: readonly [string, string, ...string[]];
}

export type NestedHookEventSpec =
  | NestedSingleHookEventSpec
  | NestedMultiHookEventSpec;

export interface NestedJsonIntegrationSpec {
  agentId: AgentKind;
  configPath: () => string;
  /** 默认：配置文件已存在才安装（loomdesk 语义）。 */
  detect?: () => boolean;
  events: readonly NestedHookEventSpec[];
  runtime: Omit<AgentRuntimeSemantics, "emittedMappings">;
  /** 兼容宿主设置这些变量时不执行本提供方的 Pier hook。 */
  skipWhenEnvPresent?: readonly string[];
  /**
   * 事件未单独声明 `timeout` 时的默认值（字段名历史遗留；单位因 agent 而异）。
   * 例：Claude/Codex 默认秒；Gemini/Qwen 传 10_000 表示毫秒。
   */
  timeoutSeconds?: number;
}

/** 解析嵌套 hook 写入配置的 timeout：事件级 > spec 默认 > 工厂默认。 */
export function resolveNestedHookTimeout(
  event: NestedHookEventBase,
  spec: Pick<NestedJsonIntegrationSpec, "timeoutSeconds">
): number {
  return event.timeout ?? spec.timeoutSeconds ?? DEFAULT_NESTED_HOOK_TIMEOUT;
}

interface NestedHookMatcher {
  hooks: Array<{ command?: unknown; timeout?: number; type?: unknown }>;
  matcher?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNestedHooksInstallShapeSupported(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): boolean {
  if (!Object.hasOwn(settings, "hooks")) {
    return true;
  }
  const hooks = settings.hooks;
  if (!isPlainObject(hooks)) {
    return false;
  }
  for (const nativeEvent of new Set(
    spec.events.map((event) => event.nativeEvent)
  )) {
    if (
      Object.hasOwn(hooks, nativeEvent) &&
      !Array.isArray(hooks[nativeEvent])
    ) {
      return false;
    }
  }
  return true;
}

export function preflightPierNestedHooksInstall(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): boolean {
  const supported = isNestedHooksInstallShapeSupported(settings, spec);
  if (!supported) {
    console.warn(
      `[agent-hooks:${spec.agentId}] hooks has unrecognized structure, skip install`
    );
  }
  return supported;
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

function withoutPierNestedHandlers(entry: unknown): {
  changed: boolean;
  entry: unknown | null;
} {
  if (!entry || typeof entry !== "object") {
    return { changed: false, entry };
  }
  const hooks = (entry as NestedHookMatcher).hooks;
  if (!Array.isArray(hooks)) {
    return { changed: false, entry };
  }
  const kept = hooks.filter((hook) => !isManagedPierHookCommand(hook?.command));
  if (kept.length === hooks.length) {
    return { changed: false, entry };
  }
  if (kept.length === 0) {
    return { changed: true, entry: null };
  }
  return {
    changed: true,
    entry: { ...(entry as Record<string, unknown>), hooks: kept },
  };
}

function withoutPierNestedEntries(entries: unknown[]): {
  changed: boolean;
  entries: unknown[];
} {
  const kept: unknown[] = [];
  let changed = false;
  for (const entry of entries) {
    const result = withoutPierNestedHandlers(entry);
    changed ||= result.changed;
    if (result.entry !== null) {
      kept.push(result.entry);
    }
  }
  return { changed, entries: kept };
}

/** 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。 */
export function withPierNestedHooks(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): Record<string, unknown> {
  if (!preflightPierNestedHooksInstall(settings, spec)) {
    return settings;
  }
  const hooks = hooksRecord(settings);
  // 同一原生事件可以按 matcher 拆成多条规范事实（例如 Gemini ask_user）。
  // 先按键统一剔除旧 Pier 条目，再依次追加当前 spec；若在循环内逐条剔除，
  // 后一 matcher 会误删同一轮刚写入的前一 matcher。
  for (const nativeEvent of new Set(
    spec.events.map((event) => event.nativeEvent)
  )) {
    const current = hooks[nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    hooks[nativeEvent] = withoutPierNestedEntries(existing).entries;
  }
  for (const event of spec.events) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const command =
      event.buildCommand?.(spec.agentId) ??
      pierHookCommandWithStdinSessionId(
        spec.agentId,
        event.pierEvent,
        event.nativeEvent
      );
    const pierEntry: NestedHookMatcher = {
      ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
      hooks: [
        {
          command: skipHookCommandWhenEnvPresent(
            command,
            spec.skipWhenEnvPresent
          ),
          timeout: resolveNestedHookTimeout(event, spec),
          type: "command",
        },
      ],
    };
    hooks[event.nativeEvent] = [...existing, pierEntry];
  }
  return { ...settings, hooks };
}

/**
 * 纯函数：剔除全部 pier hook 条目, 空事件键一并删除。
 * 无 pier 条目时原样返回输入引用（启动期关→卸载对齐不得空写用户文件）。
 */
export function withoutPierNestedHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const cleaned = withoutPierNestedEntries(entries);
    if (!cleaned.changed) {
      continue;
    }
    changed = true;
    if (cleaned.entries.length > 0) {
      hooks[key] = cleaned.entries;
    } else {
      delete hooks[key];
    }
  }
  if (!changed) {
    return settings;
  }
  return { ...settings, hooks };
}

export function createNestedJsonIntegration(
  spec: NestedJsonIntegrationSpec
): AgentHookIntegration {
  return {
    detect: spec.detect ?? (() => existsSync(spec.configPath())),
    id: spec.agentId,
    runtime: {
      ...spec.runtime,
      emittedMappings: spec.events.flatMap(
        ({ emittedPierEvents, nativeEvent, pierEvent }) =>
          (emittedPierEvents ?? [pierEvent]).map((emittedPierEvent) => ({
            nativeEvent,
            pierEvent: emittedPierEvent,
          }))
      ),
    },
    // install 先剔全部 pier 条目再按当前 spec 写入——覆盖「上一版 spec 装过
    // 但本版已移出」的遗留；withPierNestedHooks 只处理当前 spec 内事件，
    // 不会自行清理已经废弃的事件键。
    install: () =>
      transformJsonConfig(
        spec.configPath(),
        (s) => {
          // 必须在 legacy Pier 条目清理前先确认所有权形状；否则异常用户
          // 结构可能被清理步骤部分改写，再由安装步骤覆盖。
          if (!preflightPierNestedHooksInstall(s, spec)) {
            return s;
          }
          return transformPierHooksUnlessNewer(s, (current) =>
            withPierNestedHooks(withoutPierNestedHooks(current), spec)
          );
        },
        spec.agentId
      ),
    uninstall: () =>
      transformJsonConfig(
        spec.configPath(),
        withoutPierNestedHooks,
        spec.agentId
      ),
  };
}
