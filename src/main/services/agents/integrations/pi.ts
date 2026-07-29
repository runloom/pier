import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
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

/** 固定提交 0c32e83 的公开扩展事件。 */
const PI_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> = [
  { nativeEvent: "session_start", pierEvent: "SessionStart" },
  { nativeEvent: "before_agent_start", pierEvent: "PromptSubmit" },
  { nativeEvent: "tool_execution_start", pierEvent: "ToolStart" },
  { nativeEvent: "tool_execution_end", pierEvent: "ToolComplete" },
  { nativeEvent: "agent_settled", pierEvent: "Stop" },
  { nativeEvent: "session_shutdown", pierEvent: "SessionEnd" },
];

/**
 * `$PI_CODING_AGENT_DIR` 默认 `~/.pi/agent`（loomdesk piHome 同款：`~` 展开、
 * `~/` 前缀展开、其余原样使用）。
 */
export function piHome(): string {
  const raw = (process.env.PI_CODING_AGENT_DIR ?? "").trim();
  if (!raw) {
    return join(homedir(), ".pi", "agent");
  }
  if (raw === "~") {
    return homedir();
  }
  if (raw.startsWith("~/")) {
    return join(homedir(), raw.slice(2));
  }
  return raw;
}

export function piExtensionPath(): string {
  return join(piHome(), "extensions", EXTENSION_FILE_NAME);
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
	const toolUseId =
		nativePayload && typeof nativePayload.toolCallId === "string"
			? nativePayload.toolCallId
			: undefined;
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
		...(sessionId ? { sessionId } : {}),
		...(toolUseId ? { toolUseId } : {}),
		...(toolName ? { toolName } : {}),
		...(details.nativeState ? { nativeState: details.nativeState } : {}),
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
