import { existsSync } from "node:fs";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookIntegration, AgentRuntimeSemantics } from "../types.ts";
import {
  isManagedPierHookCommand,
  skipHookCommandWhenEnvPresent,
} from "./command-core.ts";
import {
  transformJsonConfig,
  transformPierHooksUnlessNewer,
} from "./config.ts";
import { pierHookCommandWithStdinSessionId } from "./stdin-commands.ts";

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
  /**
   * 事件键形态（默认 `wrapped`）：
   * - `wrapped`：事件映射在配置顶层 `hooks` 键下（Claude 系 settings 等）。
   * - `flat`：独立 hooks.json 事件键直接在顶层（Factory Droid 官方规范：
   *   「Standalone hooks.json files are keyed directly by event name」，
   *   `hooks` 包裹仅用于 settings.json；droid 0.213.0 实测 wrapped 独立
   *   文件整份被忽略，hook 永不执行）。
   */
  hooksKeyStyle?: "flat" | "wrapped";
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
  if (spec.hooksKeyStyle === "flat") {
    // flat：事件键在顶层；legacy wrapped `hooks` 键若存在必须是对象，且其
    // 事件键形状必须同样可理解——迁移期安装会剥其中 pier 条目，异常结构
    // 必须整体跳过（不得部分改写用户文件）。
    for (const nativeEvent of new Set(
      spec.events.map((event) => event.nativeEvent)
    )) {
      if (
        Object.hasOwn(settings, nativeEvent) &&
        !Array.isArray(settings[nativeEvent])
      ) {
        return false;
      }
    }
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

/** 构造单条 pier matcher 条目（flat / wrapped 共用）。 */
function buildPierNestedEntry(
  event: NestedHookEventSpec,
  spec: NestedJsonIntegrationSpec
): NestedHookMatcher {
  const command =
    event.buildCommand?.(spec.agentId) ??
    pierHookCommandWithStdinSessionId(
      spec.agentId,
      event.pierEvent,
      event.nativeEvent
    );
  return {
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
}

/**
 * flat 形态：事件键直接在配置顶层（Factory Droid 独立 hooks.json 规范）。
 * 写入后同时剔除 legacy wrapped `hooks` 记录里的 pier 条目（旧安装器误写
 * 遗留；用户条目原样保留，droid 本就不读 wrapped 独立文件）。
 */
function withPierFlatEventKeys(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...settings };
  // 同一原生事件可以按 matcher 拆成多条规范事实；先按键统一剔除旧 Pier
  // 条目，再依次追加当前 spec（对齐 wrapped 语义，防逐条剔除互删）。
  for (const nativeEvent of new Set(
    spec.events.map((event) => event.nativeEvent)
  )) {
    const existing = Array.isArray(next[nativeEvent])
      ? (next[nativeEvent] as unknown[])
      : [];
    next[nativeEvent] = withoutPierNestedEntries(existing).entries;
  }
  for (const event of spec.events) {
    const existing = Array.isArray(next[event.nativeEvent])
      ? (next[event.nativeEvent] as unknown[])
      : [];
    next[event.nativeEvent] = [...existing, buildPierNestedEntry(event, spec)];
  }
  return withoutWrappedPierRecord(next);
}

/** 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。 */
export function withPierNestedHooks(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): Record<string, unknown> {
  if (!preflightPierNestedHooksInstall(settings, spec)) {
    return settings;
  }
  if (spec.hooksKeyStyle === "flat") {
    return withPierFlatEventKeys(settings, spec);
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
    hooks[event.nativeEvent] = [...existing, buildPierNestedEntry(event, spec)];
  }
  return { ...settings, hooks };
}

/**
 * 纯函数：剔除 wrapped `hooks` 记录内全部 pier hook 条目, 空事件键一并删除。
 * 无 pier 条目时原样返回输入引用（启动期关→卸载对齐不得空写用户文件）。
 */
function withoutWrappedPierRecord(
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
  // 既有语义：清空后 `hooks` 键保留为 {}（goose 卸载测试锁定）。
  return { ...settings, hooks };
}

/**
 * 纯函数：剔除全部 pier hook 条目。默认只处理 wrapped `hooks` 记录；flat
 * 形态（`spec.hooksKeyStyle === "flat"`）同时处理配置顶层的事件键数组
 * （空键删除），并保留 legacy wrapped 记录内的用户条目。
 */
export function withoutPierNestedHooks(
  settings: Record<string, unknown>,
  spec?: Pick<NestedJsonIntegrationSpec, "hooksKeyStyle">
): Record<string, unknown> {
  const withoutWrapped = withoutWrappedPierRecord(settings);
  if (spec?.hooksKeyStyle !== "flat") {
    return withoutWrapped;
  }
  let next = withoutWrapped;
  let changed = next !== settings;
  for (const key of Object.keys(next)) {
    if (key === "hooks") {
      continue;
    }
    const entries = next[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    const cleaned = withoutPierNestedEntries(entries);
    if (!cleaned.changed) {
      continue;
    }
    changed = true;
    next =
      cleaned.entries.length > 0
        ? { ...next, [key]: cleaned.entries }
        : omitKey(next, key);
  }
  return changed ? next : settings;
}

function omitKey(
  settings: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const { [key]: _removed, ...rest } = settings;
  return rest;
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
            withPierNestedHooks(withoutPierNestedHooks(current, spec), spec)
          );
        },
        spec.agentId
      ),
    uninstall: () =>
      transformJsonConfig(
        spec.configPath(),
        (s) => withoutPierNestedHooks(s, spec),
        spec.agentId
      ),
  };
}
