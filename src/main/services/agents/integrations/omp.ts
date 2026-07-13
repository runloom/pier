import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { atomicWriteFile, commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";
import { JAVASCRIPT_LOCKED_APPEND_SOURCE } from "./writer-lock-source.ts";

const AGENT_ID: AgentKind = "omp";
const EXTENSION_FILE_NAME = "pier-agent-status.ts";
const MARKER = "pier-agent-status:v1 (managed by Pier)";

/**
 * omp 主会话事件 → pier 事件名。
 *
 * 映射依据为 omp 事件流实测（2026-07-05 probe：-p 多轮工具 / RPC abort /
 * -p task subagent 三场景）, 非 loomdesk eventStatusMap 照搬——其
 * `turn_end → Stop` 是错的：
 * - omp 的 `turn_start`/`turn_end` 是 agent loop 内**每轮 LLM round** 的
 *   边界, 一次用户提问发 N 次；映射 Stop 会在多轮工具循环中途谎报
 *   「等待输入」, 且 Stop 置 turnEnded 后还会吸收后续真实工具事件。
 * - 回合真边界是 `agent_start`/`agent_end`（每个 prompt 各发一次；abort/
 *   ESC 中断同样收 agent_end, 无「卡在思考中」风险）。
 * - `tool_approval_requested`/`tool_approval_resolved` 补 waiting
 *   （等待确认）态；resolved 不辨批准/拒绝一律回 ToolStart——批准路径
 *   （绝大多数）立即准确；拒绝路径短暂错标 tool, 由后续事件在本轮 loop
 *   收敛内纠正（denial 作为 tool result 喂回模型, loop 必以 agent_end
 *   收敛——abort 这一更极端路径都发 agent_end, 已实证）, 不值得解析载荷。
 */
const OMP_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> = [
  { nativeEvent: "session_start", pierEvent: "SessionStart" },
  { nativeEvent: "agent_start", pierEvent: "PromptSubmit" },
  { nativeEvent: "tool_call", pierEvent: "ToolStart" },
  { nativeEvent: "tool_result", pierEvent: "ToolComplete" },
  { nativeEvent: "tool_approval_requested", pierEvent: "PermissionRequest" },
  { nativeEvent: "tool_approval_resolved", pierEvent: "ToolStart" },
  { nativeEvent: "agent_end", pierEvent: "Stop" },
  { nativeEvent: "session_shutdown", pierEvent: "SessionEnd" },
];

/**
 * omp task subagent 实例事件 → pier 子代理计数事件。
 *
 * task subagent 与主会话同进程、各自执行一遍扩展工厂（实测同 pid 多次
 * factory 调用, 子实例 ctx.hasUI === false）。子实例事件若按主表直发会
 * 打穿主状态：turn/agent 结束 → 谎报「等待输入」, session_shutdown →
 * 拆层 + 1.5s 冷却吞掉主会话后续事件。故子实例只上报
 * SubagentStart/SubagentStop——聚合器仅计数（badge「N 个子代理」）,
 * 不改父状态。
 */
const OMP_SUBAGENT_EVENTS: ReadonlyArray<{
  nativeEvent: string;
  pierEvent: string;
}> = [
  { nativeEvent: "agent_start", pierEvent: "SubagentStart" },
  { nativeEvent: "agent_end", pierEvent: "SubagentStop" },
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

/** 生成逐事件订阅行：主/子映射合一, 每个原生事件单次订阅、按角色分派。 */
function subscriptionLines(): string {
  const byNative: Record<string, { main?: string; sub?: string }> = {};
  for (const { nativeEvent, pierEvent } of OMP_EVENTS) {
    const entry = byNative[nativeEvent] ?? {};
    entry.main = pierEvent;
    byNative[nativeEvent] = entry;
  }
  for (const { nativeEvent, pierEvent } of OMP_SUBAGENT_EVENTS) {
    const entry = byNative[nativeEvent] ?? {};
    entry.sub = pierEvent;
    byNative[nativeEvent] = entry;
  }
  // JSON.stringify 兼作转义与 null 序列化——表内值现为纯 ASCII 标识符,
  // 但生成器不赌未来（未转义的 `"` 会让生成源码整体语法错误、静默失活）。
  const quote = (v: string | undefined) => JSON.stringify(v ?? null);
  return Object.entries(byNative)
    .map(
      ([nativeEvent, m]) =>
        `\tpi.on(${quote(nativeEvent)}, (event, ctx) => pierDispatch(ctx, ${quote(nativeEvent)}, ${quote(m.main)}, ${quote(m.sub)}, event));`
    )
    .join("\n");
}

/**
 * 整文件 TS 扩展源码。刻意不写顶层 import 声明：electron-vite 打包 main 时
 * 会扫描模板字面量, 若嵌入源码内含顶层 `import ...` 语句, 可能被误判为
 * 真实模块引用, 注入非法 CJS __dirname shim 到 ESM 产物（loomdesk 踩过的坑,
 * 见 omp.ts/pi.ts 头部注释）。emit 用 `process.getBuiltinModule("node:fs")`
 * 同步 append（运行时调用, 非 ImportDeclaration；Bun 与 Node ≥20.16 均支持）：
 * 同步既保事件文件序（聚合器按 JSONL 文件序消费, 同毫秒事件在未 await 的
 * 异步 append 下会乱序）, 也保证宿主退出前最后的 session_shutdown 落盘。
 * 三 PIER_ 环境变量任一缺失即静默 no-op——非 Pier 启动的 agent 不受影响。
 *
 * 角色判定（主会话 vs task subagent, 见 OMP_SUBAGENT_EVENTS 注释）：
 * - TUI/RPC 主会话 `ctx.hasUI === true`；
 * - print/headless 主会话 hasUI=false, 靠「进程内首个实例必是主会话」
 *   兜底——subagent 只能由已运行的主 loop spawn, 必然后加载；
 * - 其余（非首实例且无 UI）判为 subagent。模块级计数在同进程多次工厂
 *   调用间共享（loader 以相同 mtime URL 复用同一模块实例）。
 *
 * 取舍：判定含糊时宁可漏报（静默）不可误报——若 omp 未来整个移除 hasUI
 * 字段, 本判定仍靠计数器正确降级（首实例=主, 其余=子）；反向方案
 * （要求 hasUI === false 才判子）在同一情形下会把全部实例判成主,
 * 子实例事件直发打穿主状态, 正是本次修的 bug。
 */
export function buildOmpExtensionSource(): string {
  return `// pier-agent-status:v1 (managed by Pier). Safe to leave in place.
// ${MARKER}
// Deliberately no top-level import declarations: electron-vite scans
// template literals in main's bundle and can otherwise inject an invalid
// CommonJS shim into the ESM output. process.getBuiltinModule is a runtime
// call — not an ImportDeclaration — so the scan stays inert; available in
// Bun (omp's extension host) and Node >= 20.16.

${JAVASCRIPT_LOCKED_APPEND_SOURCE}

let pierInstanceCount = 0;

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

function pierEmit(event, nativeEvent, actorHint, ...values) {
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
		agent: "omp",
		event,
		nativeEvent,
		...(actorHint ? { actorHint } : {}),
		...(sessionId ? { sessionId } : {}),
	}) + "\\n";
	pierAppend(log, line);
}

export default function PierAgentStatus(pi) {
	// Main session vs task subagent: subagents run in-process with their own
	// extension instance (ctx.hasUI === false). Main = has UI (TUI/RPC), or
	// first instance in this process (print/headless main loads before any
	// subagent can spawn). Subagent instances only report Subagent counters;
	// forwarding their session/turn events would corrupt the main status.
	const isFirstInstance = pierInstanceCount === 0;
	pierInstanceCount += 1;
	let role = null;
	function pierDispatch(ctx, nativeEvent, mainEvent, subEvent, ...values) {
		if (role === null) {
			role =
				(ctx && ctx.hasUI === true) || isFirstInstance ? "main" : "sub";
		}
		const event = role === "main" ? mainEvent : subEvent;
		if (event) {
			pierEmit(
				event,
				nativeEvent,
				role === "sub" ? "subagent" : undefined,
				...values,
				ctx,
			);
		}
	}

${subscriptionLines()}
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
  runtime: { stopAuthority: "authoritative" },
  install: () => installOmpExtension(),
  uninstall: () => uninstallOmpExtension(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const OMP_EVENT_MAP = OMP_EVENTS;

/** 子代理事件表导出（测试断言用）。 */
export const OMP_SUBAGENT_EVENT_MAP = OMP_SUBAGENT_EVENTS;

/** marker 常量导出（测试断言用）。 */
export const OMP_MARKER = MARKER;
