import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import {
  isPierManagedPluginContent,
  pierManagedPluginMarker,
  writeManagedPluginFile,
} from "./managed-plugin-file.ts";
import { JAVASCRIPT_PROMPT_SNIPPET_SOURCE } from "./prompt-snippet-source.ts";
import { atomicWriteFile, commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";
import { JAVASCRIPT_LOCKED_APPEND_SOURCE } from "./writer-lock-source.ts";

const AGENT_ID: AgentKind = "opencode";
const OPENCODE_EMITTED_MAPPINGS = [
  { nativeEvent: "session.created", pierEvent: "SessionStart" },
  { nativeEvent: "session.idle", pierEvent: "Stop" },
  { nativeEvent: "session.error", pierEvent: "error" },
  { nativeEvent: "session.deleted", pierEvent: "SessionEnd" },
  { nativeEvent: "session.status=busy", pierEvent: "running" },
  { nativeEvent: "session.status=retry", pierEvent: "running" },
  { nativeEvent: "session.status=idle", pierEvent: "Stop" },
  { nativeEvent: "chat.message", pierEvent: "PromptSubmit" },
  { nativeEvent: "permission.asked", pierEvent: "InteractionRequested" },
  { nativeEvent: "permission.replied", pierEvent: "InteractionResolved" },
  { nativeEvent: "question.asked", pierEvent: "InteractionRequested" },
  { nativeEvent: "question.replied", pierEvent: "InteractionResolved" },
  { nativeEvent: "question.rejected", pierEvent: "InteractionResolved" },
  { nativeEvent: "tool.execute.before", pierEvent: "ToolStart" },
  { nativeEvent: "tool.execute.after", pierEvent: "ToolComplete" },
  { nativeEvent: "message.part.updated=completed", pierEvent: "ToolComplete" },
  { nativeEvent: "message.part.updated=error", pierEvent: "ToolComplete" },
  { nativeEvent: "session.status=busy.child", pierEvent: "SubagentStart" },
  { nativeEvent: "session.status=retry.child", pierEvent: "SubagentStart" },
  { nativeEvent: "session.status=idle.child", pierEvent: "SubagentStop" },
  { nativeEvent: "session.error.child", pierEvent: "SubagentStop" },
  { nativeEvent: "session.deleted.child", pierEvent: "SubagentStop" },
] as const;

/** Host-side evidence table for S1 gates (mirrors plugin mapPierEvent). */
export const OPENCODE_PERMISSION_NATIVE_EVENTS = ["permission.asked"] as const;

export function mapOpenCodeNativeEventToPier(
  nativeType: string
): string | null {
  if (nativeType === "permission.asked") return "InteractionRequested";
  if (nativeType === "permission.replied") return "InteractionResolved";
  return null;
}

/**
 * 插件文件名。部署进 opencode 的**自动发现目录**（<configRoot>/plugins/）——
 * 实证发现 config `plugin` 数组的绝对路径注册在当前 opencode 版本不生效
 * （官方文档也只承诺自动发现目录）, 发现目录方案已实测启动即加载。
 */
const PLUGIN_FILE = "pier-agent-status.js";
/** 旧版本部署名与位置（config 数组注册 + ~/.pier/plugins/）——遗留清理用。 */
const LEGACY_PLUGIN_FILE = "opencode-agent-status.js";

/** 托管标记：写在插件源码内, install 幂等比对 + uninstall 删除前必查。 */
const PLUGIN_MARKER = pierManagedPluginMarker();

/** 官方全局自动发现目录内的插件路径。项目级 `.opencode` 不属于全局安装位。 */
export function opencodePluginPath(): string {
  return join(dirname(opencodeConfigPath()), "plugins", PLUGIN_FILE);
}

function legacyPluginPath(): string {
  return join(homedir(), ".pier", "plugins", LEGACY_PLUGIN_FILE);
}

/**
 * OpenCode v1.18.9 官方全局配置路径。JSONC 是宿主创建与写回时的首选；
 * `~/.opencode` 仅可能是主目录作为项目时的项目级配置，不能作为全局安装根。
 */
function candidateConfigPaths(): string[] {
  const configured = process.env.XDG_CONFIG_HOME;
  const xdgConfigHome =
    configured && isAbsolute(configured)
      ? configured
      : join(homedir(), ".config");
  const root = join(xdgConfigHome, "opencode");
  return [join(root, "opencode.jsonc"), join(root, "opencode.json")];
}

export function opencodeConfigPath(): string {
  for (const candidate of candidateConfigPaths()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidateConfigPaths()[0] as string;
}

/**
 * 插件源码：固定支持 OpenCode 1.x 插件接口，已核对 v1.18.9
 * （4da7bb44c84e013fa53e9c5d02ac753d1435c81a）。该稳定版仍兼容命名
 * factory 导出；尚未发布的 v2 插件接口改为 default `{id, setup|effect}`，
 * 无法用同一事件插件兼容，升级到 v2 前必须另做适配。
 *
 * emit 用 `process.getBuiltinModule("node:fs")` 同步 append（同 omp 先例：
 * 同步既保文件序——聚合器按 JSONL 文件序消费, 也保证宿主退出前
 * session.idle 落盘；opencode fire-and-forget 行为下尤为关键——handler
 * 返回的 promise 被 runtime 丢弃, 异步 append 可能永远完不成）；
 * 旧 Node 宿主退化为异步 best-effort。env 三要素任一缺失即静默 no-op。
 * 事件映射以该稳定版官方插件文档和运行时事件桥为准：
 * session.created→SessionStart, session.idle→Stop, session.error→error,
 * chat.message→PromptSubmit，permission.asked/replied 与 question.*
 * 分别闭合交互（asked 挡住工具直到 replied；allow 规则不发 asked）。
 * session.status(busy/retry)→running、
 * (idle)→Stop（EventSessionStatus——模型忙碌/重试中的推进心跳）。
 * session.idle / session.status=idle 不是回合完成：OpenCode 自己的
 * session.turn.completed（#23503 / #23650）未合入，插件作者也写明 idle
 * 粒度不够。Stop 因此只做 advisory 候选，不抬 ready。
 * tool.execute.before→ToolStart, tool.execute.after→ToolComplete。
 */
export function buildOpencodePluginSource(
  pluginId: AgentKind = AGENT_ID
): string {
  return `// ${PLUGIN_MARKER}
// Do not edit; this file is regenerated by Pier and any changes may be lost.
// Targets the OpenCode 1.x plugin API (validated with v1.18.9).
// No top-level import declarations: process.getBuiltinModule is a runtime
// call — not an ImportDeclaration; older Node falls back to async best-effort.
// (Exception to ts-no-dynamic-import: generated file for a foreign host.)

${JAVASCRIPT_LOCKED_APPEND_SOURCE}
${JAVASCRIPT_PROMPT_SNIPPET_SOURCE}

const pierChildren = new Map();
function pierProps(raw) {
  return raw && !Array.isArray(raw) && raw.properties || {};
}
function pierSessionId(raw) {
  for (const value of [raw, pierProps(raw), ...(Array.isArray(raw) ? raw : [])]) {
    if (!value || typeof value !== "object") continue;
    const info = value.info || value.message;
    const id = value.sessionID || value.sessionId || value.session_id ||
      (info && (info.sessionID || info.sessionId || info.id));
    if (typeof id === "string" && id) return id;
  }
}
function pierEmit(event, nativeEvent, raw, extra = {}) {
  const log = process.env.PIER_AGENT_EVENT_LOG;
  const panelId = process.env.PIER_PANEL_ID;
  const windowId = process.env.PIER_WINDOW_ID;
  if (!log || !panelId || !windowId) return;
  const sessionId = extra.sessionId || pierSessionId(raw);
  const parentSessionId = sessionId && pierChildren.get(sessionId);
  const line = JSON.stringify({
    v: 3,
    kind: "agentEvent",
    ts: Date.now() * 1_000_000,
    panelId,
    windowId,
    pid: process.pid,
    agent: "${pluginId}",
    event,
    nativeEvent,
    ...(parentSessionId ? { actorHint: "subagent", parentSessionId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...extra,
  }) + "\\n";
  try {
    pierAppend(log, line);
  } catch {
    // Pier status reporting must never affect the agent run.
  }
}
function pierInteraction(event, kind, outcome) {
  const p = pierProps(event);
  pierEmit(
    outcome ? "InteractionResolved" : "InteractionRequested",
    event.type,
    event,
    {
      interactionId: p.id || p.requestID,
      interactionKind: kind,
      ...(outcome ? { interactionOutcome: outcome } : {}),
    }
  );
}
export const PierAgentStatus = () => {
  return {
    event: ({ event }) => {
      if (!event || typeof event.type !== "string") return;
      const p = pierProps(event);
      const sessionId = pierSessionId(event);
      if (event.type === "session.created") {
        const parent = p.info && p.info.parentID;
        if (sessionId && parent) pierChildren.set(sessionId, parent);
        else pierEmit("SessionStart", event.type, event);
      } else if (event.type === "session.status") {
        const state = p.status && p.status.type;
        const child = sessionId && pierChildren.has(sessionId);
        if (child && (state === "busy" || state === "retry"))
          pierEmit("SubagentStart", event.type + "=" + state + ".child", event, { agentInstanceId: sessionId, nativeState: state });
        else if (child && state === "idle")
          pierEmit("SubagentStop", event.type + "=idle.child", event, { agentInstanceId: sessionId, nativeState: state });
        else if (state === "busy" || state === "retry")
          pierEmit("running", event.type + "=" + state, event, { nativeState: state });
        else if (state === "idle")
          pierEmit("Stop", event.type + "=idle", event, { nativeState: state });
      } else if (event.type === "session.idle") {
        if (sessionId && pierChildren.has(sessionId))
          pierEmit("SubagentStop", "session.status=idle.child", event, { agentInstanceId: sessionId });
        else pierEmit("Stop", event.type, event);
      } else if (event.type === "session.error") {
        if (sessionId && pierChildren.has(sessionId))
          pierEmit("SubagentStop", "session.error.child", event, { agentInstanceId: sessionId, nativeState: "error" });
        else pierEmit("error", event.type, event, { nativeState: "error" });
      } else if (event.type === "session.deleted") {
        if (sessionId && pierChildren.has(sessionId)) {
          pierEmit("SubagentStop", "session.deleted.child", event, { agentInstanceId: sessionId });
          pierChildren.delete(sessionId);
        } else pierEmit("SessionEnd", event.type, event);
      } else if (event.type === "permission.asked") pierInteraction(event, "permission");
      else if (event.type === "permission.replied")
        pierInteraction(event, "permission", p.reply === "reject" ? "rejected" : "accepted");
      else if (event.type === "question.asked") pierInteraction(event, "question");
      else if (event.type === "question.replied") pierInteraction(event, "question", "completed");
      else if (event.type === "question.rejected") pierInteraction(event, "question", "rejected");
      else if (event.type === "message.part.updated") {
        const part = p.part;
        const state = part && part.type === "tool" && part.state && part.state.status;
        if (state === "completed" || state === "error")
          pierEmit("ToolComplete", "message.part.updated=" + state, event, { toolUseId: part.callID, toolName: part.tool, nativeState: state });
      }
    },
    "chat.message": (input, output) => {
      pierEmit("PromptSubmit", "chat.message", input, {
        turnId: input.messageID || (output.message && output.message.id),
        promptSnippet: pierPromptSnippetFrom({ content: output.parts }, output.message),
      });
    },
    "tool.execute.before": (input) => {
      pierEmit("ToolStart", "tool.execute.before", input, { toolUseId: input.callID, toolName: input.tool });
    },
    "tool.execute.after": (input) => {
      pierEmit("ToolComplete", "tool.execute.after", input, { toolUseId: input.callID, toolName: input.tool });
    },
  };
};
`;
}

async function readPluginFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 部署插件文件：非托管/更高世代跳过；字节相同不落盘。
 * 返回 true 表示可以（或已经）安全部署——供 config 注册步骤继续。
 */
async function deployPluginFile(
  pluginPath: string,
  source: string
): Promise<void> {
  await writeManagedPluginFile({
    path: pluginPath,
    source,
    label: AGENT_ID,
  });
}

function pluginArray(config: Record<string, unknown>): unknown[] {
  return Array.isArray(config.plugin) ? [...(config.plugin as unknown[])] : [];
}

function pluginSpec(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }
  if (Array.isArray(entry) && typeof entry[0] === "string") {
    return entry[0];
  }
  return null;
}

/**
 * 只认 Pier 自己写过的注册条目。注意不能按裸文件名匹配——loomdesk 也用
 * opencode-agent-status.js 文件名（部署在 ~/.loomdesk/plugins/）, 误删会
 * 破坏用户的 loomdesk 集成。
 */
function normalizedPluginPath(spec: string): string | null {
  try {
    const path = spec.startsWith("file:") ? fileURLToPath(spec) : spec;
    return normalize(path).replaceAll("\\", "/");
  } catch {
    return null;
  }
}

function isPierPluginSpec(
  spec: string,
  ownedPluginPaths: readonly string[]
): boolean {
  const normalized = normalizedPluginPath(spec);
  if (normalized === null) {
    return false;
  }
  return ownedPluginPaths.some(
    (ownedPath) => normalizedPluginPath(ownedPath) === normalized
  );
}

/**
 * 纯函数：移除 config `plugin` 数组里的 pier 注册条目（旧版本布局遗留）。
 * 无匹配时原样返回输入引用（无变化不落盘守卫依赖引用相等）。
 * plugin 数组清空时保留空数组（不凭空删除用户已有的键结构）。
 */
export function withoutPierOpencodePlugin(
  config: Record<string, unknown>,
  ownedPluginPaths: readonly string[] = []
): Record<string, unknown> {
  const plugin = pluginArray(config);
  const filtered = plugin.filter((entry) => {
    const spec = pluginSpec(entry);
    return spec === null || !isPierPluginSpec(spec, ownedPluginPaths);
  });
  if (filtered.length === plugin.length) {
    return config;
  }
  return { ...config, plugin: filtered };
}

async function cleanupLegacyConfig(
  configPath: string,
  ownedPluginPaths: readonly string[]
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return;
  }

  const errors: ParseError[] = [];
  const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
  if (
    errors.length > 0 ||
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] config unparsable, skip:`,
      configPath
    );
    return;
  }

  const plugin = pluginArray(parsed as Record<string, unknown>);
  const indices = plugin.flatMap((entry, index) => {
    const spec = pluginSpec(entry);
    return spec !== null && isPierPluginSpec(spec, ownedPluginPaths)
      ? [index]
      : [];
  });
  if (indices.length === 0) {
    return;
  }

  let updated = raw;
  for (const index of indices.toReversed()) {
    updated = applyEdits(
      updated,
      modify(updated, ["plugin", index], undefined, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
    );
  }
  await atomicWriteFile(configPath, updated);
}

/**
 * 只把文件内容 marker 已证明为 Pier 托管的路径交给 config 清理。
 * 同名路径本身不是所有权证据；非托管文件及其用户注册必须原样保留。
 */
async function cleanupOwnedOpencodeConfig(
  configPath: string,
  managedPluginPath: string
): Promise<void> {
  const legacyPath = legacyPluginPath();
  const [legacy, current] = await Promise.all([
    readPluginFile(legacyPath),
    readPluginFile(managedPluginPath),
  ]);
  const legacyOwned = legacy !== null && isPierManagedPluginContent(legacy);
  const currentOwned = current !== null && isPierManagedPluginContent(current);
  const ownedPluginPaths = [
    ...(legacyOwned ? [legacyPath] : []),
    ...(currentOwned ? [managedPluginPath] : []),
  ];
  if (ownedPluginPaths.length > 0 && existsSync(configPath)) {
    await cleanupLegacyConfig(configPath, ownedPluginPaths);
  }
  if (legacyOwned) {
    await rm(legacyPath, { force: true });
  }
}

export async function installOpencodeHooks(
  configPath: string = opencodeConfigPath(),
  pluginPath: string = opencodePluginPath()
): Promise<void> {
  await deployPluginFile(pluginPath, buildOpencodePluginSource());
  await cleanupOwnedOpencodeConfig(configPath, pluginPath);
}

/**
 * uninstall：先撤销 config 注册, 再删托管插件文件（检查 marker 再删,
 * 非托管文件绝不删除）。文件不存在视为已卸载。
 */
export async function uninstallOpencodeHooks(
  configPath: string = opencodeConfigPath(),
  pluginPath: string = opencodePluginPath()
): Promise<void> {
  await cleanupOwnedOpencodeConfig(configPath, pluginPath);
  const existing = await readPluginFile(pluginPath);
  if (existing === null) {
    return;
  }
  if (!isPierManagedPluginContent(existing)) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] unmanaged plugin file present, skip uninstall:`,
      pluginPath
    );
    return;
  }
  await rm(pluginPath, { force: true });
}

function opencodeDetect(): boolean {
  return (
    existsSync(dirname(candidateConfigPaths()[0] as string)) ||
    commandExistsOnPath("opencode")
  );
}

export const opencodeIntegration: AgentHookIntegration = {
  detect: opencodeDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: OPENCODE_EMITTED_MAPPINGS,
    stopAuthority: "advisory",
  },
  install: () => installOpencodeHooks(),
  uninstall: () => uninstallOpencodeHooks(),
};

/** marker 常量导出（测试断言用）。 */
export const OPENCODE_PLUGIN_MARKER_TEXT = PLUGIN_MARKER;
export const OPENCODE_PLUGIN_FILE_NAME = PLUGIN_FILE;
