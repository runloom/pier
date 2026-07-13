import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { atomicWriteFile, commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";
import { JAVASCRIPT_LOCKED_APPEND_SOURCE } from "./writer-lock-source.ts";

const AGENT_ID: AgentKind = "pi";
const EXTENSION_FILE_NAME = "pier-agent-status.ts";
const MARKER = "pier-agent-status:v1 (managed by Pier)";

/**
 * pi 事件 → pier 事件名（capability "coarse"——pi 无工具/权限粒度, 仅回合级
 * session/prompt/run/stop 边界）。
 * agent_start → PromptSubmit（与 omp 对齐）：agent_start 在 model validation
 * 成功后才触发, 不存在 validation 失败时状态卡 processing 到 TTL 的问题；
 * 旧 input 事件在 validation 前触发, 已删。
 */
const PI_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> = [
  { nativeEvent: "session_start", pierEvent: "SessionStart" },
  { nativeEvent: "agent_start", pierEvent: "PromptSubmit" },
  { nativeEvent: "agent_end", pierEvent: "Stop" },
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
  return `// pier-agent-status:v1 (managed by Pier). Safe to leave in place.
// ${MARKER}
// Deliberately no top-level import declarations: electron-vite scans
// template literals in main's bundle and can otherwise inject an invalid
// CommonJS shim into the ESM output. process.getBuiltinModule is a runtime
// call — not an ImportDeclaration — so the scan stays inert; available in
// Bun and Node >= 20.16. Older Node falls back to async best-effort.
// (Exception to ts-no-dynamic-import: generated file for a foreign host.)

${JAVASCRIPT_LOCKED_APPEND_SOURCE}

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
	}
	return undefined;
}

function pierEmit(event, nativeEvent, ...values) {
	const log = process.env.PIER_AGENT_EVENT_LOG;
	const panelId = process.env.PIER_PANEL_ID;
	const windowId = process.env.PIER_WINDOW_ID;
	if (!log || !panelId || !windowId) return;
	const sessionId = pierSessionIdFrom(values);
	const line = JSON.stringify({
		v: 2,
		kind: "agentEvent",
		ts: Date.now() * 1_000_000,
		panelId,
		windowId,
		pid: process.pid,
		agent: "pi",
		event,
		nativeEvent,
		...(sessionId ? { sessionId } : {}),
	}) + "\\n";
	try {
		pierAppend(log, line);
	} catch {
		// best-effort, never throw into the agent's own event loop
	}
}

export default function PierAgentStatus(pi) {
	// 加载即 agent 启动：合成 SessionStart 点亮启动态图标（事件流要到首个
	// 会话/消息才有信号）。pi-mono 无 subagent 机制（Agent.prompt() throws
	// if already processing）, 不存在 omp 式多实例加载风险, 合成安全。
	pierEmit("SessionStart", "pier.synthetic.session_start");

	pi.on("session_start", (event, ctx) => pierEmit("SessionStart", "session_start", event, ctx));
	pi.on("agent_start", (event, ctx) => pierEmit("PromptSubmit", "agent_start", event, ctx));
	pi.on("agent_end", (event, ctx) => pierEmit("Stop", "agent_end", event, ctx));
	pi.on("session_shutdown", (event, ctx) => pierEmit("SessionEnd", "session_shutdown", event, ctx));
}
`;
}

function isManagedByPier(raw: string): boolean {
  return raw.includes(MARKER);
}

async function readExtensionRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 整文件 overwrite；仅当文件缺失或已由 pier 管理时才写。非托管文件一律
 * 跳过并 warn, 不覆盖。
 */
export async function installPiExtension(
  path: string = piExtensionPath()
): Promise<void> {
  if (!piDetect()) {
    return;
  }
  const existing = await readExtensionRaw(path);
  if (existing !== null && !isManagedByPier(existing)) {
    console.warn(
      "[agent-hooks:pi] existing unmanaged extension file, skip install:",
      path
    );
    return;
  }
  const next = buildPiExtensionSource();
  if (existing === next) {
    return;
  }
  await atomicWriteFile(path, next);
}

/** 仅删除含 marker 的托管文件；非托管/不存在时零副作用。 */
export async function uninstallPiExtension(
  path: string = piExtensionPath()
): Promise<void> {
  const existing = await readExtensionRaw(path);
  if (existing === null || !isManagedByPier(existing)) {
    return;
  }
  await rm(path, { force: true });
}

export const piIntegration: AgentHookIntegration = {
  capability: "coarse",
  detect: piDetect,
  id: AGENT_ID,
  runtime: { stopAuthority: "authoritative" },
  install: () => installPiExtension(),
  uninstall: () => uninstallPiExtension(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const PI_EVENT_MAP = PI_EVENTS;

/** marker 常量导出（测试断言用）。 */
export const PI_MARKER = MARKER;
