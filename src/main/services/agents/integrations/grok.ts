import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveGrokHome } from "../grok-paths.ts";
import { GROK_INTERACTIVE_BLOCKING_TOOLS } from "./interactive-blocking-tools.ts";
import { interactiveBlockingToolLifecycleEvents } from "./interactive-tool-lifecycle.ts";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
} from "./shared.ts";

const grokHomeDir = () => resolveGrokHome();
const grokConfigPath = () => join(grokHomeDir(), "hooks", "pier-status.json");

/**
 * Grok hook 事件 → pier 事件名。
 *
 * 运行证据固定为本机 grok 签名二进制（1.0.13）及随附
 * docs/user-guide/10-hooks.md、19-plan-mode.md、CHANGELOG.md；事件表包含正式事件与
 * SubagentEnd 别名。公开 grok-build 仓库源码快照仅用于核验字段定义与事件
 * 调用点，不冒充已安装版本源码。
 * stdin 身份字段为 camelCase：sessionId / toolUseId / toolName；
 * 子智能体字段为 subagentId / subagentType，不借用其他产品的 agentId。
 *
 * **子会话事件识别（2026-08-29 审计，高危修复）**：官方文档明示
 * UserPromptSubmit/Stop/工具等全局 hook 也会在**子智能体自己的会话**内
 * 触发，事件携带 `subagentType`（并警告后台子智能体会钉住宿主忙碌态）。
 * 全部命令提取 subagentType 并按 `actorHintFromAgentType` 标
 * actorHint=subagent——子会话事件走子会话旁路（非 Subagent 事件被
 * subagent-detail-ignored 丢弃），不再生成无法封账的活跃 scope。
 * 主会话事件不带该字段，hint 缺席不受影响。
 *
 * **promptId 回合锚点（1.0.13 起每个事件携带；session 级事件缺席）**：
 * 全部命令提取为 turnId。官方文档明示乱序对账要用 promptId 而非时钟——
 * StopCancelled 可能晚于下一回合 UserPromptSubmit 到达，状态机的
 * settled/abandoned 分账 + 权威回合保护依赖它把迟到终态拒之门外。
 *
 * **StopCancelled → TurnInterrupted（可信中断终态）**：reason 枚举
 * user_interrupt / permission_rejected / permission_cancelled / max_turns /
 * no_progress / unknown（文档 10-hooks.md），全部语义都是「回合未完成即
 * 停止」。落 nativeState 供溯源。旧版无该 hook → 不触发，transcript
 * 对账（updates.jsonl turn_completed cancelled）仍是兜底。
 *
 * 路径与发现机制（`GROK_HOME`，默认 `~/.grok`，另加 PATH 命令探测）。
 * 用专用文件 `<GROK_HOME>/hooks/pier-status.json`：整个文件归 Pier 管理，
 * install 全量写，uninstall 删条目后若 hooks 为空则写空对象
 * （工厂 withoutPierNestedHooks 已保证）。
 *
 * matcher 约定：工具事件省略 matcher（文档：empty/omitted = match all；
 * 裸 "*" 是正则非法式，不依赖未文档化的特殊处理）。
 * 生命周期事件（SessionStart/SessionEnd/Stop/UserPromptSubmit）拒绝 matcher。
 *
 * **不装 Notification**：文档定义是「agent 发送通知」，实机 payload 以
 * "Turn complete" / "Background task completed" 为主，映成 waiting
 * 会造成假「需要你处理」。Grok 无独立 PermissionRequest 原生事件；
 * waiting：plan 走 Pre/Post Interaction；ask_user_question 只走 transcript。
 * 「请求修改」会丢掉 exit_plan_mode 且不发 Post。
 *
 * PermissionDenied：普通工具 → ToolComplete；交互工具 → InteractionResolved
 * rejected（同一 toolUseId 结算）。
 * StopFailure→error：API 错误导致回合终止。
 * PreCompact/PostCompact→processing：长压缩期间无其他 hook，避免 TTL 误衰减。
 * SubagentStart/SubagentStop：聚合器仅计数不改状态（Stop 由子会话发出，
 * 用 instance 别名与 Start 闭环，不做 sessionIdAsParent）。
 *
 * Stop 门禁注意：Stop 是可阻断门，被第三方 stop 门 block 后会带
 * stopHookActive 重发——advisory 候选会短暂假 ready，下一工具事件即取消
 * 候选（现状可接受；Pier 自身 hook 不阻断）。
 */
const GROK_SUBAGENT_SESSION_EXTRACTION = {
  actorHintFromAgentType: true,
  agentTypeFields: ["subagentType"],
} as const;

const GROK_TURN_EXTRACTION = {
  turnIdFields: ["promptId"],
} as const;

function grokCommand(
  nativeEvent: string,
  event:
    | "SessionStart"
    | "PromptSubmit"
    | "processing"
    | "Stop"
    | "TurnInterrupted"
    | "error"
    | "SubagentStart"
    | "SubagentStop"
    | "SessionEnd"
): string {
  const isSubagent =
    nativeEvent === "SubagentStart" || nativeEvent === "SubagentStop";
  let nativeStateFields: readonly string[] | undefined;
  if (nativeEvent === "StopFailure") {
    nativeStateFields = ["error"];
  } else if (
    nativeEvent === "Stop" ||
    nativeEvent === "SessionEnd" ||
    nativeEvent === "StopCancelled"
  ) {
    nativeStateFields = ["reason"];
  }
  return pierHookCommandV3WithStdin({
    agentId: "grok",
    ...(isSubagent
      ? {
          actorHintFromAgentId: true,
          agentInstanceIdFields: ["subagentId"],
          agentTypeFields: ["subagentType"],
          ...(nativeEvent === "SubagentStart"
            ? { sessionIdAsParent: true }
            : {}),
        }
      : { ...GROK_SUBAGENT_SESSION_EXTRACTION, ...GROK_TURN_EXTRACTION }),
    event,
    nativeEvent,
    ...(nativeStateFields ? { nativeStateFields } : {}),
  });
}

const GROK_SPEC: NestedJsonIntegrationSpec = {
  agentId: "grok",
  runtime: { stopAuthority: "advisory" },
  configPath: grokConfigPath,
  detect: () => existsSync(grokHomeDir()) || commandExistsOnPath("grok"),
  events: [
    {
      buildCommand: () => grokCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: () => grokCommand("UserPromptSubmit", "PromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    ...interactiveBlockingToolLifecycleEvents({
      // camelCase toolUseId/toolName 已在固定别名组内；历史的单段
      // toolNamePaths/toolUseIdPaths 会被提取脚本 ≥2 段规则过滤（死配置），
      // 一并移除。
      ...GROK_SUBAGENT_SESSION_EXTRACTION,
      ...GROK_TURN_EXTRACTION,
      includePermissionDenied: true,
      tools: GROK_INTERACTIVE_BLOCKING_TOOLS,
    }),
    {
      buildCommand: () => grokCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: () => grokCommand("StopCancelled", "TurnInterrupted"),
      nativeEvent: "StopCancelled",
      pierEvent: "TurnInterrupted",
    },
    {
      buildCommand: () => grokCommand("StopFailure", "error"),
      nativeEvent: "StopFailure",
      pierEvent: "error",
    },
    {
      buildCommand: () => grokCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: () => grokCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: () => grokCommand("PreCompact", "processing"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => grokCommand("PostCompact", "processing"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => grokCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
  ],
};

export const GROK_HOOK_EVENTS = GROK_SPEC.events;

export const grokIntegration = createNestedJsonIntegration(GROK_SPEC);
