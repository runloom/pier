import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { Minimatch } from "minimatch";
import {
  isPierManagedPluginContent,
  pierManagedPluginMarker,
  writeManagedPluginFile,
} from "./managed-plugin-file.ts";
import { JAVASCRIPT_PROMPT_SNIPPET_SOURCE } from "./prompt-snippet-source.ts";
import { commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";
import { JAVASCRIPT_LOCKED_APPEND_SOURCE } from "./writer-lock-source.ts";

const AGENT_ID: AgentKind = "pi";
const EXTENSION_FILE_NAME = "pier-agent-status.ts";
const MARKER = pierManagedPluginMarker();

/**
 * 公开扩展事件（0.84.4 本机 dist 核对）。
 *
 * 2026-08-29 审计修正：
 * - 移除历史误植的 `tool_execution_start/end.ask` 分支——`ask` 是 omp
 *   自有工具，pi 无内置同名工具（docs 与 dist 零匹配），该分支永不触发
 *   却在矩阵里冒充 native waiting 证据。
 * - 新增 `ui_prompt_start/end`：pi **专为状态集成设计**的阻塞 UI 提示
 *   事件（docs/extensions.md："so host/status integrations can report
 *   'waiting for user' instead of just 'running'"）。上游以深度计数保证
 *   最外层严格 1:1 配对、`finally` 兜底 end（runner.ts withUIPrompt），
 *   匿名交互计数安全。载荷 `{kind, title?}`，kind 落 nativeState。
 */
const PI_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> = [
  { nativeEvent: "session_start", pierEvent: "SessionStart" },
  { nativeEvent: "before_agent_start", pierEvent: "PromptSubmit" },
  { nativeEvent: "tool_execution_start", pierEvent: "ToolStart" },
  { nativeEvent: "tool_execution_end", pierEvent: "ToolComplete" },
  { nativeEvent: "ui_prompt_start", pierEvent: "InteractionRequested" },
  { nativeEvent: "ui_prompt_end", pierEvent: "InteractionResolved" },
  { nativeEvent: "agent_settled", pierEvent: "Stop" },
  { nativeEvent: "session_shutdown", pierEvent: "SessionEnd" },
];

/**
 * `$PI_CODING_AGENT_DIR` 默认 `~/.pi/agent`（loomdesk piHome 同款：`~` 展开、
 * `~/` 前缀展开、其余原样使用）。
 */
export function resolvePiHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? homedir();
  const raw = (env.PI_CODING_AGENT_DIR ?? "").trim();
  if (!raw) {
    return join(home, ".pi", "agent");
  }
  if (raw === "~") {
    return home;
  }
  if (raw.startsWith("~/")) {
    return join(home, raw.slice(2));
  }
  return raw;
}

export function piHome(): string {
  return resolvePiHome();
}

export function piExtensionPath(): string {
  return join(piHome(), "extensions", EXTENSION_FILE_NAME);
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

/**
 * pi 的 `extensions` 覆盖语序（dist/core/package-manager.js
 * `isEnabledByOverrides`）：默认启用 → `!glob` 排除 → `+path` 强制启用 →
 * `-path` 强制排除。`+` / `-` 只做精确路径匹配，`!` 才走 glob；
 * 匹配前与 pi 一样做路径归一化（`file://`、`~`、`./`、反斜杠）。
 *
 * 只看全局 `settings.json`：项目级覆盖需要项目上下文，设置页没有，
 * 宁可少提示也不误报（fail-open）。
 */
export function isStatusExtensionEnabled(
  patterns: readonly string[] | undefined,
  extensionPath: string,
  agentDir: string,
  home: string = homedir()
): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  const overrides = patterns.filter(
    (pattern) =>
      pattern.startsWith("!") ||
      pattern.startsWith("+") ||
      pattern.startsWith("-")
  );
  const excludes = overrides
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  const forceIncludes = overrides
    .filter((pattern) => pattern.startsWith("+"))
    .map((pattern) => pattern.slice(1));
  const forceExcludes = overrides
    .filter((pattern) => pattern.startsWith("-"))
    .map((pattern) => pattern.slice(1));

  const rel = toPosixPath(relative(agentDir, extensionPath));
  const name = basename(extensionPath);
  const absolute = toPosixPath(extensionPath);
  const normalizePattern = (pattern: string): string => {
    let value = pattern;
    if (value.startsWith("file://")) {
      value = value.slice("file://".length);
    }
    if (value === "~") {
      value = home;
    } else if (value.startsWith("~/")) {
      value = join(home, value.slice(2));
    }
    return toPosixPath(value);
  };
  const matchesGlob = (pattern: string): boolean => {
    const matcher = new Minimatch(normalizePattern(pattern));
    return matcher.match(rel) || matcher.match(name) || matcher.match(absolute);
  };
  const matchesExact = (pattern: string): boolean => {
    const normalized = normalizePattern(pattern);
    const stripped = normalized.startsWith("./")
      ? normalized.slice(2)
      : normalized;
    return stripped === rel || stripped === absolute;
  };

  let enabled = true;
  if (excludes.some((pattern) => matchesGlob(pattern))) {
    enabled = false;
  }
  if (forceIncludes.some((pattern) => matchesExact(pattern))) {
    enabled = true;
  }
  if (forceExcludes.some((pattern) => matchesExact(pattern))) {
    enabled = false;
  }
  return enabled;
}

/**
 * Pier 写入的 pi 状态扩展是否被用户自己的 pi 设置禁用。设置文件缺失或
 * 损坏时不报警（安装流程负责重建扩展），只在可解析且确实排除时返回 true；
 * 读取失败留给日志，避免把「文件坏了」伪装成「配置已开启」。
 */
export async function readStatusHooksDisabledByConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const agentDir = resolvePiHome(env);
  const extensionPath = join(agentDir, "extensions", EXTENSION_FILE_NAME);
  const home = env.HOME ?? homedir();
  try {
    const source = await readFile(extensionPath, "utf8");
    // Only claim a missing status feed for an extension Pier actually wrote.
    if (!isPierManagedPluginContent(source)) {
      return false;
    }
    const text = await readFile(join(agentDir, "settings.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    const raw =
      typeof parsed === "object" && parsed !== null && "extensions" in parsed
        ? (parsed as { extensions?: unknown }).extensions
        : undefined;
    const patterns = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === "string")
      : [];
    return !isStatusExtensionEnabled(patterns, extensionPath, agentDir, home);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        "[agent-hooks:pi] failed to read status extension settings:",
        error
      );
    }
    return false;
  }
}

export function piDetect(): boolean {
  return existsSync(piHome()) || commandExistsOnPath("pi");
}

/**
 * 整文件 TS 扩展源码。同 omp：刻意不写顶层 import 声明（electron-vite
 * 模板字面量扫描陷阱, 见 loomdesk pi.ts 头部注释）。emit 用
 * `process.getBuiltinModule("node:fs")` 同步 append（同 omp 先例：
 * 同步既保文件序——聚合器按 JSONL 文件序消费, 也保证宿主退出前
 * session_shutdown 落盘）；旧 Node 宿主退化为异步 best-effort。
 * 三 PIER_ 环境变量缺任一即静默 no-op。
 */
export function buildPiExtensionSource(): string {
  return `// ${MARKER}. Safe to leave in place.
// Deliberately no top-level import declarations: electron-vite scans
// template literals in main's bundle and can otherwise inject an invalid
// CommonJS shim into the ESM output. process.getBuiltinModule is a runtime
// call — not an ImportDeclaration — so the scan stays inert; available in
// Bun and Node >= 20.16. Older Node falls back to async best-effort.
// (Exception to ts-no-dynamic-import: generated file for a foreign host.)

${JAVASCRIPT_LOCKED_APPEND_SOURCE}
${JAVASCRIPT_PROMPT_SNIPPET_SOURCE}

function pierSessionIdFrom(values) {
	for (const value of values) {
		if (!value || typeof value !== "object") continue;
		for (const key of ["sessionId", "sessionID", "session_id"]) {
			if (typeof value[key] === "string" && value[key]) return value[key];
		}
		const session = value.session || value.thread;
		if (session && typeof session === "object") {
			for (const key of ["id", "sessionId", "sessionID", "session_id"]) {
				if (typeof session[key] === "string" && session[key]) return session[key];
			}
		}
		// pi/omp extension ctx carries session identity on sessionManager,
		// not on the event payload (session_start is just { type }).
		const manager = value.sessionManager;
		if (manager && typeof manager === "object") {
			if (typeof manager.getSessionId === "function") {
				try {
					const id = manager.getSessionId();
					if (typeof id === "string" && id) return id;
				} catch {}
			}
			if (typeof manager.getSessionFile === "function") {
				try {
					const file = manager.getSessionFile();
					if (typeof file === "string" && file) {
						const base = file.split(/[\\\\/]/).pop() || "";
						const match = base.match(/_([0-9a-fA-F-]{8,})\\.jsonl$/);
						if (match?.[1]) return match[1];
					}
				} catch {}
			}
		}
	}
	return undefined;
}

function pierBoundWorkId(value) {
	if (typeof value !== "string" || !value) return undefined;
	const pipe = value.indexOf("|");
	const core = pipe === -1 ? value : value.slice(0, pipe);
	return core.length <= 1024 ? core : core.slice(0, 1024);
}

function pierEmit(event, nativeEvent, nativePayload, ctx, details = {}) {
	const log = process.env.PIER_AGENT_EVENT_LOG;
	const panelId = process.env.PIER_PANEL_ID;
	const windowId = process.env.PIER_WINDOW_ID;
	if (!log || !panelId || !windowId) return;
	const sessionId = pierSessionIdFrom([nativePayload, ctx]);
	const promptSnippet =
		event === "PromptSubmit"
			? pierPromptSnippetFrom(nativePayload, ctx)
			: undefined;
	const toolUseId = pierBoundWorkId(
		nativePayload && typeof nativePayload.toolCallId === "string"
			? nativePayload.toolCallId
			: undefined
	);
	const interactionId = pierBoundWorkId(details.interactionId);
	const toolName =
		nativePayload && typeof nativePayload.toolName === "string"
			? nativePayload.toolName
			: undefined;
	const line = JSON.stringify({
		v: 3,
		kind: "agentEvent",
		ts: Date.now() * 1_000_000,
		panelId,
		windowId,
		pid: process.pid,
		agent: "pi",
		event,
		nativeEvent,
		...pierSpawnGenerationFromEnv(),
		...(sessionId ? { sessionId } : {}),
		...(toolUseId ? { toolUseId } : {}),
		...(toolName ? { toolName } : {}),
		...(details.nativeState ? { nativeState: details.nativeState } : {}),
		...(interactionId ? { interactionId } : {}),
		...(details.interactionKind
			? { interactionKind: details.interactionKind }
			: {}),
		...(details.interactionOutcome
			? { interactionOutcome: details.interactionOutcome }
			: {}),
		...(promptSnippet ? { promptSnippet } : {}),
	}) + "\\n";
	try {
		pierAppend(log, line);
	} catch {
		// best-effort, never throw into the agent's own event loop
	}
}

export default function PierAgentStatus(pi) {
	pi.on("session_start", (event, ctx) =>
		pierEmit("SessionStart", "session_start", event, ctx));
	pi.on("before_agent_start", (event, ctx) =>
		pierEmit("PromptSubmit", "before_agent_start", event, ctx));
	pi.on("tool_execution_start", (event, ctx) =>
		pierEmit("ToolStart", "tool_execution_start", event, ctx));
	pi.on("tool_execution_end", (event, ctx) =>
		pierEmit("ToolComplete", "tool_execution_end", event, ctx, {
			nativeState: event && event.isError === true ? "error" : "completed",
		}));
	// 扩展弹出 ctx.ui.select/confirm/input/editor 的阻塞提示：上游深度计数
	// 保证最外层 start/end 严格配对且 finally 兜底 end，匿名交互计数安全。
	pi.on("ui_prompt_start", (event, ctx) =>
		pierEmit("InteractionRequested", "ui_prompt_start", event, ctx, {
			interactionKind: "question",
			nativeState:
				event && typeof event.kind === "string" ? event.kind : undefined,
		}));
	pi.on("ui_prompt_end", (event, ctx) =>
		pierEmit("InteractionResolved", "ui_prompt_end", event, ctx, {
			interactionKind: "question",
			interactionOutcome: "completed",
			nativeState:
				event && typeof event.kind === "string" ? event.kind : undefined,
		}));
	pi.on("agent_settled", (event, ctx) =>
		pierEmit("Stop", "agent_settled", event, ctx));
	pi.on("session_shutdown", (event, ctx) =>
		pierEmit("SessionEnd", "session_shutdown", event, ctx));
}
`;
}

async function readExtensionRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 整文件 overwrite；仅当文件缺失或已由 pier 管理时才写。
 * 非托管 / 更高世代跳过。
 */
export async function installPiExtension(
  path: string = piExtensionPath()
): Promise<void> {
  if (!piDetect()) {
    return;
  }
  const existing = await readExtensionRaw(path);
  if (
    existing !== null &&
    isPierManagedPluginContent(existing) &&
    existing.includes('agent: "omp"')
  ) {
    console.warn(
      "[agent-hooks:pi] omp plugin already owns this path, skip install:",
      path
    );
    return;
  }
  await writeManagedPluginFile({
    path,
    source: buildPiExtensionSource(),
    label: AGENT_ID,
  });
}

/** 仅删除含 marker 的托管文件；非托管/不存在时零副作用。 */
export async function uninstallPiExtension(
  path: string = piExtensionPath()
): Promise<void> {
  const existing = await readExtensionRaw(path);
  if (existing === null || !isPierManagedPluginContent(existing)) {
    return;
  }
  await rm(path, { force: true });
}

export const piIntegration: AgentHookIntegration = {
  detect: piDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: PI_EVENTS,
    stopAuthority: "authoritative",
  },
  install: () => installPiExtension(),
  uninstall: () => uninstallPiExtension(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const PI_EVENT_MAP = PI_EVENTS;

/** marker 常量导出（测试断言用）。 */
export const PI_MARKER = MARKER;
