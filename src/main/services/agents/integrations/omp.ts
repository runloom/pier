import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { atomicWriteFile, commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "omp";
const EXTENSION_FILE_NAME = "pier-agent-status.ts";
const MARKER = "pier-agent-status:v1 (managed by Pier)";

/**
 * omp 事件 → pier 事件名（loomdesk omp.ts eventStatusMap 对齐, capability
 * "full"）。
 */
const OMP_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> = [
  { nativeEvent: "session_start", pierEvent: "SessionStart" },
  { nativeEvent: "turn_start", pierEvent: "PromptSubmit" },
  { nativeEvent: "tool_call", pierEvent: "ToolStart" },
  { nativeEvent: "tool_result", pierEvent: "ToolComplete" },
  { nativeEvent: "turn_end", pierEvent: "Stop" },
  { nativeEvent: "session_shutdown", pierEvent: "SessionEnd" },
];

/**
 * `$OMP_HOME` 默认 `~/.omp/agent`（loomdesk ompHome 同款：`~` 展开、
 * `~/` 前缀展开、其余原样使用）。
 */
export function ompHome(): string {
  const raw = (process.env.OMP_HOME ?? "").trim();
  if (!raw) {
    return join(homedir(), ".omp", "agent");
  }
  if (raw === "~") {
    return homedir();
  }
  if (raw.startsWith("~/")) {
    return join(homedir(), raw.slice(2));
  }
  return raw;
}

export function ompExtensionPath(): string {
  return join(ompHome(), "extensions", EXTENSION_FILE_NAME);
}

export function ompDetect(): boolean {
  return existsSync(ompHome()) || commandExistsOnPath("omp");
}

/**
 * 整文件 TS 扩展源码。刻意不写顶层 import 声明：electron-vite 打包 main 时
 * 会扫描模板字面量, 若嵌入源码内含顶层 `import ...` 语句, 可能被误判为
 * 真实模块引用, 注入非法 CJS __dirname shim 到 ESM 产物（loomdesk 踩过的坑,
 * 见 omp.ts/pi.ts 头部注释）。emit 用运行时 require 拿到 fs.promises
 * （CJS 宿主执行, omp/pi 扩展跑在各自宿主进程, 非 electron 渲染/主进程沙箱）
 * 直写 JSONL, 三 PIER_ 环境变量任一缺失即静默 no-op——非 Pier 启动的
 * agent 不受影响。
 */
export function buildOmpExtensionSource(): string {
  return `// pier-agent-status:v1 (managed by Pier). Safe to leave in place.
// ${MARKER}
// Deliberately no top-level import declarations: electron-vite scans
// template literals in main's bundle and can otherwise inject an invalid
// CommonJS shim into the ESM output. \`await import()\` inside function
// body is a CallExpression, not ImportDeclaration, so vite AST scan
// doesn't fire; works in both CJS (Node <20) and ESM (Node 20+) hosts.
// (Exception to ts-no-dynamic-import: generated file for a foreign host.)

async function pierEmit(event) {
	const log = process.env.PIER_AGENT_EVENT_LOG;
	const panelId = process.env.PIER_PANEL_ID;
	const windowId = process.env.PIER_WINDOW_ID;
	if (!log || !panelId || !windowId) return;
	const line = JSON.stringify({
		v: 1,
		kind: "agentEvent",
		ts: Date.now() * 1_000_000,
		panelId,
		windowId,
		pid: process.pid,
		agent: "omp",
		event,
	}) + "\\n";
	try {
		const { appendFile } = await import("node:fs/promises");
		await appendFile(log, line);
	} catch {
		// best-effort, never throw into the agent's own event loop
	}
}

export default function PierAgentStatus(pi) {
	// 加载即 agent 启动：合成 SessionStart 点亮启动态图标（事件流要到首个
	// 会话/消息才有信号）。
	pierEmit("SessionStart");

	pi.on("session_start", () => pierEmit("SessionStart"));
	pi.on("turn_start", () => pierEmit("PromptSubmit"));
	pi.on("tool_call", () => pierEmit("ToolStart"));
	pi.on("tool_result", () => pierEmit("ToolComplete"));
	pi.on("turn_end", () => pierEmit("Stop"));
	pi.on("session_shutdown", () => pierEmit("SessionEnd"));
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
 * 整文件 overwrite；仅当文件缺失或已由 pier 管理时才写。非托管文件
 * （用户/其他工具自带的同名扩展）一律跳过并 warn, 不覆盖。
 */
export async function installOmpExtension(
  path: string = ompExtensionPath()
): Promise<void> {
  if (!ompDetect()) {
    return;
  }
  const existing = await readExtensionRaw(path);
  if (existing !== null && !isManagedByPier(existing)) {
    console.warn(
      "[agent-hooks:omp] existing unmanaged extension file, skip install:",
      path
    );
    return;
  }
  const next = buildOmpExtensionSource();
  if (existing === next) {
    return;
  }
  await atomicWriteFile(path, next);
}

/** 仅删除含 marker 的托管文件；非托管/不存在时零副作用。 */
export async function uninstallOmpExtension(
  path: string = ompExtensionPath()
): Promise<void> {
  const existing = await readExtensionRaw(path);
  if (existing === null || !isManagedByPier(existing)) {
    return;
  }
  await rm(path, { force: true });
}

export const ompIntegration: AgentHookIntegration = {
  capability: "full",
  detect: ompDetect,
  id: AGENT_ID,
  install: () => installOmpExtension(),
  uninstall: () => uninstallOmpExtension(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const OMP_EVENT_MAP = OMP_EVENTS;

/** marker 常量导出（测试断言用）。 */
export const OMP_MARKER = MARKER;
