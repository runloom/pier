import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
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

const AGENT_ID: AgentKind = "kilo";
const KILO_EMITTED_MAPPINGS = [
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
  {
    nativeEvent: "question.asked.blocking",
    pierEvent: "InteractionRequested",
  },
  { nativeEvent: "question.replied", pierEvent: "InteractionResolved" },
  { nativeEvent: "question.rejected", pierEvent: "InteractionResolved" },
  { nativeEvent: "session.status=offline", pierEvent: "InteractionRequested" },
  { nativeEvent: "session.network.replied", pierEvent: "InteractionResolved" },
  { nativeEvent: "session.network.rejected", pierEvent: "InteractionResolved" },
  { nativeEvent: "session.network.restored", pierEvent: "InteractionResolved" },
  {
    nativeEvent: "session.status=busy.offline",
    pierEvent: "InteractionResolved",
  },
  {
    nativeEvent: "session.status=retry.offline",
    pierEvent: "InteractionResolved",
  },
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

/** Pier 部署的独立插件文件（不放 kilo 自身安装目录下, opencode 同款布局）。 */
const PLUGIN_FILE = "pier-agent-status.ts";

/** 托管标记：写在插件源码内, install 幂等比对 + uninstall 删除前必查。 */
const PLUGIN_MARKER = pierManagedPluginMarker();

/**
 * Kilo Code CLI 插件 — 依据官方文档 kilo.ai/docs/automate/extending/plugins：
 * - 插件目录**自动加载**、无需 config 注册：`<configRoot>/plugin/` 下每个
 *   `.ts`/`.js` 文件在启动时自动注册（也存在 `.kilo/plugin/` 与旧版
 *   `.kilocode/plugin/` 项目级目录, 但 pier 只装全局目录, 与其余「一次
 *   安装全局生效」的集成纪律一致）。
 * - 官方最小插件示例的导出形状是 `export default { id, server }`，
 *   其中 `server` 是 `Plugin` 类型的工厂函数
 *   `async (ctx) => ({ ...hook 实现... })`——不是 prompt 猜测的
 *   `export default { event: async ({event}) => {...} }` 直接形状（那是
 *   server 工厂*返回值*里的一个 hook 键, 不是顶层导出）。本文件按官方
 *   真实形状生成源码。已核对 v7.4.17 发布提交 a0364858 与当前同版本
 *   main 提交 a76aea71；配置根解析与插件扫描另核对固定提交 c0ebf987
 *   的 `ConfigPaths` / `ConfigPlugin`。Kilo 默认入口直接是
 *   `kilo`，没有 `--v3` 门槛；该门槛属于 Kiro CLI 3.0 early access。
 * - 事件总线映射（Events 参考页确认的事件名, SOURCE 证据）：
 *   session.created→SessionStart, session.idle→Stop, session.error→error,
 *   session.deleted→SessionEnd, session.status(busy/retry)→running、
 *   (idle)→Stop（kilo 是 opencode fork, EventSessionStatus 事件同源;
 *   Events 参考页 Session 分类明确列出 session.status）。
 *   **idle 只是 advisory 候选**（2026-08-29 审计降级）：与同源 opencode
 *   相同，idle 不代表回合完成（回合中途 compaction/自动续跑间隙同样
 *   idle，opencode 侧 #23503/#23650 未合入），且 busy/running 是 progress
 *   类（无 turnId、无 turnStartAuthority）**不能重开已封账 scope**——
 *   若把 idle 当 trusted 终态，中途 idle 封账后的工具事件会被 sealed-turn
 *   全部拒收、面板冻结到下一条用户消息（与 2026-08-29 cursor 事故同构）。
 *   fork 无「idle 语义已改进」的证据前禁止回抬 authoritative。
 *   permission 事件官方名 `permission.asked`/`permission.replied`
 *   （Events 参考页 Permission 分类明确列出; opencode 1.18.23 二进制同为
 *   permission.asked——上游已从旧 SDK 的 permission.updated 改名,
 *   两家现名一致, SOURCE）。
 *   用户消息提交走官方插件的 direct `chat.message` hook；其 input/output
 *   提供 session/message/parts，生成 PromptSubmit 并从输出 parts 提取
 *   可读提示摘要。`session.status=busy` 是回合内推进心跳，不能用它
 *   替代用户消息事实。
 *   tool：tool.execute.before→ToolStart, tool.execute.after→ToolComplete
 *   （与 opencode 集成同名事件, SOURCE 确认一致）。
 * - emit 用 appendFileSync（pierAppend 模板; Bun 宿主
 *   process.getBuiltinModule 可用, 旧 Node 退化异步 best-effort）。
 *   无顶层 import 声明（electron-vite 模板字面量扫描陷阱）。
 *   三 PIER_ 环境变量任一缺失即静默 no-op, 吞异常。
 * 状态证据由事件矩阵统一声明。
 */
export function kiloConfigDir(): string {
  const configured = process.env.KILO_CONFIG_DIR;
  if (configured && isAbsolute(configured)) {
    return configured;
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome && isAbsolute(xdgConfigHome)) {
    return join(xdgConfigHome, "kilo");
  }
  return join(homedir(), ".config", "kilo");
}

export function kiloPluginPath(): string {
  return join(kiloConfigDir(), "plugin", PLUGIN_FILE);
}

export function buildKiloPluginSource(pluginId: AgentKind = AGENT_ID): string {
  return `// ${PLUGIN_MARKER}
// Do not edit; this file is regenerated by Pier and any changes may be lost.
// Deliberately no top-level import declarations: electron-vite scans
// template literals in main's bundle and can otherwise inject an invalid
// CommonJS shim into the ESM output. process.getBuiltinModule is a runtime
// call — not an ImportDeclaration — so the scan stays inert; available in
// Bun (kilo's host) and Node >= 20.16.

${JAVASCRIPT_LOCKED_APPEND_SOURCE}
${JAVASCRIPT_PROMPT_SNIPPET_SOURCE}

function pierSessionIdFrom(event) {
	const values = Array.isArray(event) ? [...event] : [event];
	values.push(...values.map((value) => value && value.properties));
	for (const value of values) {
		if (!value || typeof value !== "object") continue;
		for (const key of ["sessionId", "sessionID", "session_id"]) {
			if (typeof value[key] === "string" && value[key]) return value[key];
		}
		const session = value.info || value.session || value.thread;
		if (session && typeof session === "object") {
			for (const key of ["id", "sessionId", "sessionID", "session_id"]) {
				if (typeof session[key] === "string" && session[key]) return session[key];
			}
		}
	}
	return undefined;
}

function pierToolIdFrom(event) {
	const values = Array.isArray(event) ? event : [event];
	for (const value of values) {
		if (!value || typeof value !== "object") continue;
		for (const key of ["callID", "callId", "toolCallID", "toolCallId", "toolUseId", "tool_use_id"]) {
			if (typeof value[key] === "string" && value[key]) return value[key];
		}
	}
	return undefined;
}

const pierParentSessionIds = new Map();
const pierOfflineRequests = new Map();
const pierBlockingQuestionIds = new Map();

function pierRememberBlockingQuestion(properties) {
	const sessionId = properties.sessionID || "";
	const ids = pierBlockingQuestionIds.get(sessionId) || new Set();
	ids.add(properties.id);
	pierBlockingQuestionIds.set(sessionId, ids);
}

function pierTakeBlockingQuestion(properties) {
	const sessionId = properties.sessionID || "";
	const ids = pierBlockingQuestionIds.get(sessionId);
	if (!ids || !ids.delete(properties.requestID)) return false;
	if (ids.size === 0) pierBlockingQuestionIds.delete(sessionId);
	return true;
}

function pierEmit(pierEvent, nativeEvent, rawEvent, extra = {}) {
	const log = process.env.PIER_AGENT_EVENT_LOG;
	const panelId = process.env.PIER_PANEL_ID;
	const windowId = process.env.PIER_WINDOW_ID;
	if (!log || !panelId || !windowId) return;
	const sessionId = pierSessionIdFrom(rawEvent);
	const toolUseId = pierToolIdFrom(rawEvent);
	const properties = rawEvent && !Array.isArray(rawEvent) && rawEvent.properties;
	const info = properties && (properties.info || properties.session);
	const nativeState =
		properties && properties.status && typeof properties.status.type === "string"
			? properties.status.type
			: undefined;
	const discoveredParentSessionId =
		(info && (info.parentID || info.parentId || info.parent_id)) ||
		(properties && (properties.parentID || properties.parentId || properties.parent_id));
	if (
		sessionId &&
		typeof discoveredParentSessionId === "string" &&
		discoveredParentSessionId
	) {
		pierParentSessionIds.set(sessionId, discoveredParentSessionId);
	}
	const parentSessionId = sessionId
		? pierParentSessionIds.get(sessionId)
		: undefined;
	const isSubagent = parentSessionId !== undefined;
	const line = JSON.stringify({
		v: 3,
		kind: "agentEvent",
		ts: Date.now() * 1_000_000,
		panelId,
		windowId,
		pid: process.pid,
		agent: "${pluginId}",
		event: pierEvent,
		nativeEvent,
		...pierSpawnGenerationFromEnv(),
		...(nativeState ? { nativeState } : {}),
		...(isSubagent ? { actorHint: "subagent" } : {}),
		...(typeof parentSessionId === "string" && parentSessionId
			? { parentSessionId }
			: {}),
		...(sessionId ? { sessionId } : {}),
		...(toolUseId ? { toolUseId } : {}),
		...extra,
	}) + "\\n";
	try {
		pierAppend(log, line);
	} catch {
		// best-effort, never throw into the agent's own event loop
	}
	if (nativeEvent === "session.deleted" && sessionId) {
		pierParentSessionIds.delete(sessionId);
	}
}

function mapPierEvent(event) {
	if (!event || typeof event.type !== "string") return null;
	if (event.type === "session.created") return "SessionStart";
	if (event.type === "session.idle") return "Stop";
	if (event.type === "session.error") return "error";
	if (event.type === "session.deleted") return "SessionEnd";
	if (event.type === "session.status") {
		// SDK EventSessionStatus: properties.status.type = busy/retry/idle
		// (kilo 是 opencode fork, SDK 事件同源; kilo.ai/docs/automate/extending/plugins
		// Events 参考页 Session 分类确认 session.status)。
		// busy/retry 是回合内推进心跳(progress 类, 只取消 advisory 候选,
		// 不能重开已封账 scope)；idle 是 advisory 候选终态(见文件头降级说明)。
		const statusType =
			event.properties && event.properties.status && event.properties.status.type;
		if (statusType === "busy" || statusType === "retry") return "running";
		if (statusType === "idle") return "Stop";
		return null;
	}
	return null;
}

function pierInteraction(event, kind, outcome, nativeEvent = event.type) {
	const p = event.properties || {};
	pierEmit(
		outcome ? "InteractionResolved" : "InteractionRequested",
		nativeEvent,
		event,
		{
			interactionId: p.id || p.requestID,
			interactionKind: kind,
			...(outcome ? { interactionOutcome: outcome } : {}),
		}
	);
}

const server = async () => {
	// session.created 提供真实 SessionStart 信号, 不再合成。
	return {
		event: async ({ event }) => {
			const p = event && event.properties || {};
			const sessionId = pierSessionIdFrom(event);
			if (event.type === "session.created") {
				const parent = p.info && p.info.parentID;
				if (sessionId && parent) {
					pierParentSessionIds.set(sessionId, parent);
					return;
				}
			}
			if (event.type === "session.status") {
				const state = p.status && p.status.type;
				const child = sessionId && pierParentSessionIds.has(sessionId);
				if (child && (state === "busy" || state === "retry")) {
					pierEmit("SubagentStart", "session.status=" + state + ".child", event, { agentInstanceId: sessionId, nativeState: state });
					return;
				}
				if (child && state === "idle") {
					pierEmit("SubagentStop", "session.status=idle.child", event, { agentInstanceId: sessionId, nativeState: state });
					return;
				}
				if (state === "offline") {
					const requestID = p.status.requestID;
					if (sessionId && requestID) pierOfflineRequests.set(sessionId, requestID);
					pierEmit("InteractionRequested", "session.status=offline", event, {
						interactionId: requestID,
						interactionKind: "external-block",
						nativeState: "offline",
					});
					return;
				}
				const offline = sessionId && pierOfflineRequests.get(sessionId);
				if (offline && (state === "busy" || state === "retry")) {
					pierEmit("InteractionResolved", "session.status=" + state + ".offline", event, {
						interactionId: offline,
						interactionKind: "external-block",
						interactionOutcome: "completed",
						nativeState: state,
					});
					pierOfflineRequests.delete(sessionId);
				}
			}
			if (event.type === "permission.asked") return pierInteraction(event, "permission");
			if (event.type === "permission.replied")
				return pierInteraction(event, "permission", p.reply === "reject" ? "rejected" : "accepted");
			if (event.type === "question.asked") {
				if (p.blocking === false) return;
				if (p.id) pierRememberBlockingQuestion(p);
				return pierInteraction(event, "question", undefined, "question.asked.blocking");
			}
			if (event.type === "question.replied" || event.type === "question.rejected") {
				if (!pierTakeBlockingQuestion(p)) return;
				return pierInteraction(
					event,
					"question",
					event.type === "question.replied" ? "completed" : "rejected"
				);
			}
			if (
				event.type === "session.network.replied" ||
				event.type === "session.network.rejected" ||
				event.type === "session.network.restored"
			) {
				const offline = sessionId && pierOfflineRequests.get(sessionId);
				if (!offline || offline !== p.requestID) return;
				pierEmit("InteractionResolved", event.type, event, {
					interactionId: p.requestID,
					interactionKind: "external-block",
					interactionOutcome: event.type.endsWith("rejected") ? "rejected" : "completed",
				});
				if (sessionId) pierOfflineRequests.delete(sessionId);
				return;
			}
			if (event.type === "message.part.updated") {
				const part = p.part;
				const state = part && part.type === "tool" && part.state && part.state.status;
				if (state === "completed" || state === "error") {
					pierEmit("ToolComplete", "message.part.updated=" + state, event, {
						toolUseId: part.callID,
						toolName: part.tool,
						nativeState: state,
					});
				}
				return;
			}
			if (event.type === "session.error" && sessionId && pierParentSessionIds.has(sessionId)) {
				pierEmit("SubagentStop", "session.error.child", event, { agentInstanceId: sessionId, nativeState: "error" });
				return;
			}
			if (event.type === "session.deleted" && sessionId && pierParentSessionIds.has(sessionId)) {
				pierOfflineRequests.delete(sessionId);
				pierBlockingQuestionIds.delete(sessionId);
				pierEmit("SubagentStop", "session.deleted.child", event, { agentInstanceId: sessionId });
				pierParentSessionIds.delete(sessionId);
				return;
			}
			if (event.type === "session.deleted" && sessionId) {
				pierOfflineRequests.delete(sessionId);
				pierBlockingQuestionIds.delete(sessionId);
			}
			const mapped = mapPierEvent(event);
			if (mapped) pierEmit(mapped, event.type, event);
		},
		"chat.message": async (input, output) => {
			pierEmit("PromptSubmit", "chat.message", input, {
				turnId: input.messageID || (output.message && output.message.id),
				promptSnippet: pierPromptSnippetFrom({ content: output.parts }, output.message),
			});
		},
		"tool.execute.before": async (input) => {
			pierEmit("ToolStart", "tool.execute.before", input, { toolUseId: input.callID, toolName: input.tool });
		},
		"tool.execute.after": async (input) => {
			pierEmit("ToolComplete", "tool.execute.after", input, { toolUseId: input.callID, toolName: input.tool });
		},
	};
};

export default { id: "${pluginId}-agent-status", server };
`;
}

async function readPluginFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function installKiloHooks(
  pluginPath: string = kiloPluginPath()
): Promise<void> {
  await writeManagedPluginFile({
    path: pluginPath,
    source: buildKiloPluginSource(),
    label: AGENT_ID,
  });
}

/**
 * uninstall：检查 marker 再删, 非托管文件绝不删除, 文件不存在视为已卸载。
 */
export async function uninstallKiloHooks(
  pluginPath: string = kiloPluginPath()
): Promise<void> {
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

function kiloDetect(): boolean {
  return (
    existsSync(kiloConfigDir()) ||
    existsSync(join(homedir(), ".kilo")) ||
    existsSync(join(homedir(), ".kilocode")) ||
    commandExistsOnPath("kilo") ||
    commandExistsOnPath("kilocode")
  );
}

export const kiloIntegration: AgentHookIntegration = {
  detect: kiloDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: KILO_EMITTED_MAPPINGS,
    // 与同源 opencode 对齐：session.idle 不是回合完成证据（见文件头
    // 2026-08-29 降级说明），advisory 候选可被后续工作取消。
    stopAuthority: "advisory",
  },
  install: () => installKiloHooks(),
  uninstall: () => uninstallKiloHooks(),
};

/** marker 常量导出（测试断言用）。 */
export const KILO_PLUGIN_MARKER_TEXT = PLUGIN_MARKER;
export const KILO_PLUGIN_FILE_NAME = PLUGIN_FILE;
