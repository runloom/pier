import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookCapability, AgentHookIntegration } from "./types.ts";

/** pier hook 命令的识别标记（命令文本必然包含该环境变量名）。 */
export const PIER_HOOK_MARK = "PIER_AGENT_HOOK_PORT";

/**
 * 生成静态 hook 命令：端口/token/panelId/windowId 运行时从环境变量读
 * （PTY 注入, shell 子进程继承），Pier 外启动的 agent 因变量缺失直接短路。
 * 事件名在安装时即为 pier 规范事件（loomdesk 模式）——接收端 agent 无关。
 * 尾部 `|| true` 保证 hook 永远 exit 0, 不干扰 agent 本体。
 */
export function pierHookCommand(agentId: AgentKind, pierEvent: string): string {
  const payload = `{\\"v\\":1,\\"agent\\":\\"${agentId}\\",\\"event\\":\\"${pierEvent}\\",\\"panelId\\":\\"$PIER_PANEL_ID\\",\\"windowId\\":\\"$PIER_WINDOW_ID\\"}`;
  return (
    `[ -n "$${PIER_HOOK_MARK}" ] && [ -n "$PIER_PANEL_ID" ] && [ -n "$PIER_WINDOW_ID" ] && ` +
    `curl -fsS -m 2 -X POST "http://127.0.0.1:$${PIER_HOOK_MARK}/agent-event" ` +
    `-H "Authorization: Bearer $PIER_AGENT_HOOK_TOKEN" ` +
    `-H "Content-Type: application/json" ` +
    `-d "${payload}" >/dev/null 2>&1 || true`
  );
}

export function isPierHookCommand(command: unknown): boolean {
  return typeof command === "string" && command.includes(PIER_HOOK_MARK);
}

/**
 * PATH 扫描探测二进制是否存在（loomdesk commandExists 同款, 集成 detect()
 * 的兜底手段）。仅安装/卸载时调用, 频率极低。
 */
export function commandExistsOnPath(command: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, command))) {
      return true;
    }
  }
  return false;
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

export interface NestedHookEventSpec {
  /** 工具类事件的 matcher；undefined = 不写 matcher 字段。 */
  matcher?: string;
  /** 该 agent 的原生事件名。 */
  nativeEvent: string;
  /** 安装时写入命令的 pier 规范事件名（runtimeStatusForHookEvent 词汇）。 */
  pierEvent: string;
}

export interface NestedJsonIntegrationSpec {
  agentId: AgentKind;
  capability: AgentHookCapability;
  configPath: () => string;
  /** 默认：配置文件已存在才安装（loomdesk 语义）。 */
  detect?: () => boolean;
  events: readonly NestedHookEventSpec[];
  timeoutSeconds?: number;
}

interface NestedHookMatcher {
  hooks: Array<{ command: string; timeout?: number; type: "command" }>;
  matcher?: string;
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

function isPierNestedEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const hooks = (entry as NestedHookMatcher).hooks;
  return (
    Array.isArray(hooks) && hooks.some((h) => isPierHookCommand(h?.command))
  );
}

/** 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。 */
export function withPierNestedHooks(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  for (const event of spec.events) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const kept = existing.filter((entry) => !isPierNestedEntry(entry));
    const pierEntry: NestedHookMatcher = {
      ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
      hooks: [
        {
          command: pierHookCommand(spec.agentId, event.pierEvent),
          timeout: spec.timeoutSeconds ?? 5,
          type: "command",
        },
      ],
    };
    hooks[event.nativeEvent] = [...kept, pierEntry];
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
    const kept = entries.filter((entry) => !isPierNestedEntry(entry));
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

export function createNestedJsonIntegration(
  spec: NestedJsonIntegrationSpec
): AgentHookIntegration {
  return {
    capability: spec.capability,
    detect: spec.detect ?? (() => existsSync(spec.configPath())),
    id: spec.agentId,
    // install 先剔全部 pier 条目再按当前 spec 写入——覆盖「上一版 spec 装过
    // 但本版已移出」的遗留(如 codex 曾装 SubagentStart/SubagentStop、后来
    // 移除, withPierNestedHooks 只处理当前 spec 内事件, 不会清废弃事件)。
    install: () =>
      transformJsonConfig(
        spec.configPath(),
        (s) => withPierNestedHooks(withoutPierNestedHooks(s), spec),
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

// ---------------------------------------------------------------------------
// 文本块注入（TOML/YAML 等无解析器场景, orca/loomdesk 的 marker 块模式）。
// ---------------------------------------------------------------------------

const TRAILING_NEWLINES_RE = /\n+$/;

export function pierBlockMarkers(agentId: AgentKind): {
  begin: string;
  end: string;
} {
  return {
    begin: `# >>> pier-agent-status:${agentId} (managed by Pier; do not edit) >>>`,
    end: `# <<< pier-agent-status:${agentId} <<<`,
  };
}

/** 纯函数：替换/追加 marker 块。block 不含 marker 行本身。 */
export function upsertPierTextBlock(
  raw: string,
  agentId: AgentKind,
  block: string
): string {
  const { begin, end } = pierBlockMarkers(agentId);
  const stripped = removePierTextBlock(raw, agentId);
  const body = `${begin}\n${block}\n${end}\n`;
  if (stripped.length === 0) {
    return body;
  }
  return `${stripped.endsWith("\n") ? stripped : `${stripped}\n`}${body}`;
}

/** 纯函数：移除 marker 块；无块时原样返回输入引用。 */
export function removePierTextBlock(raw: string, agentId: AgentKind): string {
  const { begin, end } = pierBlockMarkers(agentId);
  const beginIdx = raw.indexOf(begin);
  if (beginIdx === -1) {
    return raw;
  }
  const endIdx = raw.indexOf(end, beginIdx);
  if (endIdx === -1) {
    return raw;
  }
  const afterEnd = endIdx + end.length;
  const tail = raw.startsWith("\n", afterEnd)
    ? raw.slice(afterEnd + 1)
    : raw.slice(afterEnd);
  const head = raw.slice(0, beginIdx).replace(TRAILING_NEWLINES_RE, "\n");
  return head === "\n" ? tail : head + tail;
}
