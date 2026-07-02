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
 * 路径与发现机制（~/.grok 目录 + commandExistsOnPath("grok")）已由官方
 * docs.x.ai/llms.txt 确认。
 * 用专用文件 ~/.grok/hooks/pier-status.json（同 orca 的 orca-status.json
 * 模式）：整个文件归 Pier 管理，install 全量写，uninstall 删条目后若
 * hooks 为空则写空对象（工厂 withoutPierNestedHooks 已保证）。
 * 去掉 Notification（噪声，与其他集成一致）。
 * matcher 约定：工具事件用 "*"。
 *
 * 注意：事件 schema（下方事件名/matcher 细节）官方刻意不公开——x.ai 只在
 * in-app 的 Hooks guide 里说明，不写进公开文档站。以下事件表是
 * orca/loomdesk 汇证的 best-effort 推断，置信度低于本文件其余已核实的
 * 路径/发现机制部分。待有本机 grok 安装、可读取 in-app guide 时应重新
 * 校准这份事件表。
 */
const GROK_SPEC: NestedJsonIntegrationSpec = {
  agentId: "grok",
  capability: "full",
  configPath: grokConfigPath,
  detect: () => existsSync(grokHomeDir()) || commandExistsOnPath("grok"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
    { matcher: "*", nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { matcher: "*", nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    {
      matcher: "*",
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
  ],
};

export const grokIntegration = createNestedJsonIntegration(GROK_SPEC);
