import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

const grokHomeDir = () => join(homedir(), ".grok");
const grokConfigPath = () => join(grokHomeDir(), "hooks", "pier-status.json");

/**
 * Grok hook 事件 → pier 事件名。
 *
 * 事件表依据本机 grok v0.2.112 官方文档
 * (~/.grok/docs/user-guide/10-hooks.md, "Hook Events" 表)核定,
 * 正式事件 + SubagentEnd 别名。stdin 身份字段为 camelCase
 * （sessionId / toolUseId / toolName），由 shared 提取层双键兼容。
 *
 * 路径与发现机制（~/.grok 目录 + commandExistsOnPath("grok")）。
 * 用专用文件 ~/.grok/hooks/pier-status.json：整个文件归 Pier 管理，
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
 * PermissionDenied→processing：拒绝授权后 turn 继续，不装则 waiting 卡到 TTL。
 * StopFailure→error：API 错误导致回合终止。
 * PreCompact/PostCompact→processing：长压缩期间无其他 hook，避免 TTL 误衰减。
 * SubagentStart/SubagentStop：聚合器仅计数不改状态。
 *
 * 终态缺口：Esc/Ctrl+C、refused、max-turns、Stop 门禁满 8 次强制结束
 * **不发 Stop hook**。由 grok-transcript-reconciler 读
 * updates.jsonl 的 turn_completed（cancelled / end_turn）补齐。
 */
const GROK_SPEC: NestedJsonIntegrationSpec = {
  agentId: "grok",
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: grokConfigPath,
  detect: () => existsSync(grokHomeDir()) || commandExistsOnPath("grok"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "PostToolUseFailure", pierEvent: "ToolComplete" },
    { nativeEvent: "PermissionDenied", pierEvent: "processing" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "StopFailure", pierEvent: "error" },
    { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "PreCompact", pierEvent: "processing" },
    { nativeEvent: "PostCompact", pierEvent: "processing" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
};

export const GROK_HOOK_EVENTS = GROK_SPEC.events;

export const grokIntegration = createNestedJsonIntegration(GROK_SPEC);
