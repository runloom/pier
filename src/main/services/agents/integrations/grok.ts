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
 * 事件表依据本机 grok v0.2.32 官方文档
 * (~/.grok/docs/user-guide/10-hooks.md, "Hook Events" 表)核定,
 * 共 14 个正式事件 + SubagentEnd 别名。
 *
 * 路径与发现机制（~/.grok 目录 + commandExistsOnPath("grok")）已由官方
 * docs.x.ai/llms.txt 确认。
 * 用专用文件 ~/.grok/hooks/pier-status.json（同 orca 的 orca-status.json
 * 模式）：整个文件归 Pier 管理，install 全量写，uninstall 删条目后若
 * hooks 为空则写空对象（工厂 withoutPierNestedHooks 已保证）。
 *
 * matcher 约定：工具事件（PreToolUse/PostToolUse/PostToolUseFailure/
 * PermissionDenied）用 "*"——官方文档明确这四者 matcher 测试 tool name。
 * Notification 的 matcher 测试 notification type，省略即匹配全部。
 * 生命周期事件（SessionStart/SessionEnd/Stop/UserPromptSubmit）拒绝 matcher。
 * 其余事件（SubagentStart/SubagentStop/PreCompact/PostCompact/StopFailure）
 * 忽略 matcher。
 *
 * Notification→PermissionRequest：官方文档 line 147 明确 Notification matcher
 * 测试 notification type（工具授权信号），本机 orca hooks 也已安装。
 * PermissionDenied→processing：拒绝授权后 turn 继续，不装则 waiting 卡到 TTL。
 * StopFailure→error：API 错误导致回合终止，不装则 30min TTL 衰减。
 * PreCompact/PostCompact→processing：长压缩期间无其他 hook，避免 TTL 误衰减。
 * SubagentStart/SubagentStop：grok 原生支持 subagent（--agents/--no-subagents），
 * pier 聚合器仅计数不改状态，正确映射。
 */
const GROK_SPEC: NestedJsonIntegrationSpec = {
  agentId: "grok",
  capability: "full",
  configPath: grokConfigPath,
  detect: () => existsSync(grokHomeDir()) || commandExistsOnPath("grok"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { matcher: "*", nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { matcher: "*", nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    {
      matcher: "*",
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      matcher: "*",
      nativeEvent: "PermissionDenied",
      pierEvent: "processing",
    },
    { nativeEvent: "Notification", pierEvent: "PermissionRequest" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "StopFailure", pierEvent: "error" },
    { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "PreCompact", pierEvent: "processing" },
    { nativeEvent: "PostCompact", pierEvent: "processing" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
};

export const grokIntegration = createNestedJsonIntegration(GROK_SPEC);
