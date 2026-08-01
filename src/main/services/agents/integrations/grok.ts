import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveGrokHome } from "../grok-paths.ts";
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
 * 运行证据固定为本机 grok v0.2.114 签名二进制及随附
 * docs/user-guide/10-hooks.md、CHANGELOG.md；事件表包含正式事件与
 * SubagentEnd 别名。公开 grok-build 仓库当前只能固定到 0.2.112
 * 源码快照，因此仅用于核验字段定义与事件调用点，不冒充 0.2.114 源码。
 * stdin 身份字段为 camelCase：sessionId / toolUseId / toolName；
 * 子智能体字段为 subagentId / subagentType，不借用其他产品的 agentId。
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
 * "Turn complete" / "Background task completed" 为主，映 PermissionRequest
 * 会造成假 waiting / 假「需要你处理」。Grok 无独立 PermissionRequest 原生
 * 事件；waiting 证据不足时宁可不报，对齐 Claude/Kimi 纪律。
 *
 * PermissionDenied→ToolComplete：它是带同一 toolUseId 的工具拒绝终点，
 * 只结算该工具；不是权限请求结果，不能伪造 waiting / resolved。
 * StopFailure→error：API 错误导致回合终止。
 * PreCompact/PostCompact→processing：长压缩期间无其他 hook，避免 TTL 误衰减。
 * SubagentStart/SubagentStop：聚合器仅计数不改状态。
 *
 * 终态缺口：Esc/Ctrl+C、refused、max-turns、Stop 门禁满 8 次强制结束
 * **不发 Stop hook**。由 grok-transcript-reconciler 读
 * updates.jsonl 的 turn_completed（cancelled / end_turn）补齐。
 *
 * SessionEnd：0.2.113 变更日志已明确修复非 leader TUI 与 headless 会话
 * 退出时不执行的问题，0.2.114 当前运行证据不再保留旧版覆盖限制。
 */
function grokCommand(
  nativeEvent: string,
  event:
    | "SessionStart"
    | "PromptSubmit"
    | "ToolStart"
    | "ToolComplete"
    | "processing"
    | "Stop"
    | "error"
    | "SubagentStart"
    | "SubagentStop"
    | "SessionEnd"
): string {
  const isSubagent =
    nativeEvent === "SubagentStart" || nativeEvent === "SubagentStop";
  const isTool =
    nativeEvent === "PreToolUse" ||
    nativeEvent === "PostToolUse" ||
    nativeEvent === "PostToolUseFailure" ||
    nativeEvent === "PermissionDenied";
  let nativeStateFields: readonly string[] | undefined;
  if (nativeEvent === "PostToolUseFailure" || nativeEvent === "StopFailure") {
    nativeStateFields = ["error"];
  } else if (nativeEvent === "Stop" || nativeEvent === "SessionEnd") {
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
      : {}),
    event,
    nativeEvent,
    ...(isTool
      ? {
          toolNamePaths: ["toolName"],
          toolUseIdPaths: ["toolUseId"],
        }
      : {}),
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
    {
      buildCommand: () => grokCommand("PreToolUse", "ToolStart"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: () => grokCommand("PostToolUse", "ToolComplete"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => grokCommand("PostToolUseFailure", "ToolComplete"),
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => grokCommand("PermissionDenied", "ToolComplete"),
      nativeEvent: "PermissionDenied",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => grokCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
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
