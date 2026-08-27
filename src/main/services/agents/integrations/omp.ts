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

const AGENT_ID: AgentKind = "omp";
const EXTENSION_FILE_NAME = "pier-agent-status.ts";
const MARKER = pierManagedPluginMarker();

/**
 * omp（@oh-my-pi/pi-coding-agent）公开扩展事件映射。`agent_start` /
 * `agent_end` 语义来自上游 shared-events.d.ts（AgentEndEvent.willContinue
 * =「已调度自动续跑：auto-retry、empty-stop 重试」）。
 *
 * 诚实性关键事实（18.0.4 实测 + 上游源码）：omp 存在多条**不带
 * `before_agent_start` 的静默续跑路径**——abort 后的 steer/follow-up
 * drain（#drainStrandedQueuedMessages）、IRC peer 唤醒
 * （#resumeStrandedIrcAsides）、后台任务完成后 task executor 重新驱动。
 * 因此：
 * - `agent_start`（每次 loop 启动必发，含续跑 loop）映射 processing 并声明
 *   `turnStartAuthority: "authoritative"`——封账 scope 由它重开，否则面板
 *   会从一次 esc/stop 起永远冻在「等待输入」（2026-08-25 事故：封账后续跑
 *   37 分钟，期间全部工具事件被 sealed-turn 拒绝）。
 * - `agent_end` 且最后 assistant `stopReason === "toolUse"` 是后台工具
 *   让位（TUI 未回提示符），落 processing 不落 TurnCompleted。
 * - `stop`/`aborted` 是真实用户可见 settle，保持 trusted 终态；其后的
 *   静默续跑由 agent_start 重开兜底。
 */
const OMP_EVENTS: ReadonlyArray<{
  nativeEvent: string;
  pierEvent: string;
  turnStartAuthority?: "authoritative";
}> = [
  { nativeEvent: "session_start", pierEvent: "SessionStart" },
  {
    nativeEvent: "agent_start",
    pierEvent: "processing",
    turnStartAuthority: "authoritative",
  },
  { nativeEvent: "before_agent_start", pierEvent: "PromptSubmit" },
  { nativeEvent: "tool_execution_start", pierEvent: "ToolStart" },
  {
    nativeEvent: "tool_execution_start.ask",
    pierEvent: "InteractionRequested",
  },
  { nativeEvent: "tool_execution_end", pierEvent: "ToolComplete" },
  {
    nativeEvent: "tool_execution_end.ask",
    pierEvent: "InteractionResolved",
  },
  {
    nativeEvent: "tool_approval_requested",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "tool_approval_resolved",
    pierEvent: "InteractionResolved",
  },
  {
    nativeEvent: "agent_end.willContinue",
    pierEvent: "processing",
    turnStartAuthority: "authoritative",
  },
  { nativeEvent: "agent_end.toolUseDeferred", pierEvent: "processing" },
  { nativeEvent: "agent_end.completed", pierEvent: "TurnCompleted" },
  { nativeEvent: "agent_end.error", pierEvent: "error" },
  { nativeEvent: "agent_end.aborted", pierEvent: "TurnInterrupted" },
  { nativeEvent: "session_stop", pierEvent: "Stop" },
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
 *
 * `ask` 是阻塞问卷（与 Hermes clarify 同型）：tool_execution_start 期间
 * TUI 等人，不得标成 ToolStart（否则状态栏假「执行工具中」）。
 */
export function buildOmpExtensionSource(): string {
  return `// ${MARKER}. Safe to leave in place.
// Deliberately no top-level import declarations: electron-vite scans
// template literals in main's bundle and can otherwise inject an invalid
// CommonJS shim into the ESM output. process.getBuiltinModule is a runtime
// call — not an ImportDeclaration — so the scan stays inert; available in
// Bun (omp's extension host) and Node >= 20.16.

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
		// omp/pi extension ctx carries session identity on sessionManager,
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

function pierLastAssistantStopReason(event) {
	const messages = event && Array.isArray(event.messages) ? event.messages : [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (
			message &&
			typeof message === "object" &&
			message.role === "assistant" &&
			typeof message.stopReason === "string"
		) {
			return message.stopReason;
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
	const toolUseId = pierBoundWorkId(
		details.toolUseId ||
			(nativePayload && typeof nativePayload.toolCallId === "string"
				? nativePayload.toolCallId
				: undefined)
	);
	const interactionId = pierBoundWorkId(details.interactionId);
	const toolName =
		details.toolName ||
		(nativePayload && typeof nativePayload.toolName === "string"
			? nativePayload.toolName
			: undefined);
	const line = JSON.stringify({
		v: 3,
		kind: "agentEvent",
		ts: Date.now() * 1_000_000,
		panelId,
		windowId,
		pid: process.pid,
		agent: "omp",
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
	pierAppend(log, line);
}

export default function PierAgentStatus(pi) {
	pi.on("session_start", (event, ctx) =>
		pierEmit("SessionStart", "session_start", event, ctx));
	pi.on("agent_start", (event, ctx) =>
		pierEmit("processing", "agent_start", event, ctx, {
			nativeState: "loop_start",
		}));
	pi.on("before_agent_start", (event, ctx) =>
		pierEmit("PromptSubmit", "before_agent_start", event, ctx));
	pi.on("tool_execution_start", (event, ctx) => {
		if (event && event.toolName === "ask") {
			pierEmit("InteractionRequested", "tool_execution_start.ask", event, ctx, {
				interactionId: event.toolCallId,
				interactionKind: "question",
			});
			return;
		}
		pierEmit("ToolStart", "tool_execution_start", event, ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (event && event.toolName === "ask") {
			pierEmit("InteractionResolved", "tool_execution_end.ask", event, ctx, {
				interactionId: event.toolCallId,
				interactionKind: "question",
				interactionOutcome: event.isError === true ? "failed" : "completed",
			});
			return;
		}
		pierEmit("ToolComplete", "tool_execution_end", event, ctx, {
			nativeState: event && event.isError === true ? "error" : "completed",
		});
	});
	pi.on("tool_approval_requested", (event, ctx) =>
		pierEmit("InteractionRequested", "tool_approval_requested", event, ctx, {
			interactionId: event && event.toolCallId,
			interactionKind: "permission",
		}));
	pi.on("tool_approval_resolved", (event, ctx) => {
		const approved = event && event.approved === true;
		pierEmit("InteractionResolved", "tool_approval_resolved", event, ctx, {
			interactionId: event && event.toolCallId,
			interactionKind: "permission",
			interactionOutcome: approved ? "accepted" : "rejected",
			nativeState: approved ? "accepted" : "rejected",
		});
	});
	pi.on("agent_end", (event, ctx) => {
		// willContinue=true：omp 已调度自动续跑（auto-retry、empty-stop 重试
		// 等，见上游 AgentEndEvent 文档），保持 processing 不落终态。
		// willContinue=false：本回合 agent loop 已结束——正常完成必须落 TurnCompleted，
		// 否则状态会卡在「思考中」直到 session_stop（会话退出）才 ready。
		if (event && event.willContinue === true) {
			pierEmit("processing", "agent_end.willContinue", event, ctx, {
				nativeState: "will_continue",
			});
			return;
		}
		const stopReason = pierLastAssistantStopReason(event);
		if (stopReason === "error") {
			pierEmit("error", "agent_end.error", event, ctx, {
				nativeState: stopReason,
			});
		} else if (stopReason === "aborted") {
			pierEmit("TurnInterrupted", "agent_end.aborted", event, ctx, {
				nativeState: stopReason,
			});
		} else if (stopReason === "toolUse") {
			// toolUse：回合让位等待后台工具/任务完成，TUI 未回提示符；后续
			// task executor 续跑不带 before_agent_start，落 TurnCompleted 会
			// 把面板冻在「等待输入」。
			pierEmit("processing", "agent_end.toolUseDeferred", event, ctx, {
				nativeState: "tool_use_deferred",
			});
		} else {
			pierEmit("TurnCompleted", "agent_end.completed", event, ctx, {
				nativeState: stopReason || "completed",
			});
		}
	});
	pi.on("session_stop", (event, ctx) =>
		pierEmit("Stop", "session_stop", event, ctx));
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
export async function installOmpExtension(
  path: string = ompExtensionPath()
): Promise<void> {
  if (!ompDetect()) {
    return;
  }
  await writeManagedPluginFile({
    path,
    source: buildOmpExtensionSource(),
    label: AGENT_ID,
  });
}

/** 仅删除含 marker 的托管文件；非托管/不存在时零副作用。 */
export async function uninstallOmpExtension(
  path: string = ompExtensionPath()
): Promise<void> {
  const existing = await readExtensionRaw(path);
  if (existing === null || !isPierManagedPluginContent(existing)) {
    return;
  }
  await rm(path, { force: true });
}

export const ompIntegration: AgentHookIntegration = {
  detect: ompDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: OMP_EVENTS,
    stopAuthority: "authoritative",
  },
  install: () => installOmpExtension(),
  uninstall: () => uninstallOmpExtension(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const OMP_EVENT_MAP = OMP_EVENTS;

/** marker 常量导出（测试断言用）。 */
export const OMP_MARKER = MARKER;

/**
 * Ev5 诚实结论：omp 的 `agent_end` 会通过最后一条 `assistant` 消息的
 * `stopReason` 区分 `error` / `aborted` / `completed`，可原生映射 FA `error`。
 */
export const OMP_FA_ERROR_REACHABILITY = "native" as const;
