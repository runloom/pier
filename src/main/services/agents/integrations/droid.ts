import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  transformJsonConfig,
  withoutPierNestedHooks,
} from "./shared.ts";

/**
 * Droid (Factory AI) hook 配置路径:**~/.factory/settings.json** 的顶层
 * `hooks` 字段。
 *
 * **翻案记录**:上一波「官方核查修正」根据 docs.factory.ai/cli/configuration/
 * hooks-guide 的字面表述把 pier 从 settings.json 改到 hooks.json——**是错的**。
 * 实证:本机 loomdesk/superset 都把 droid hook 装在 settings.json 的
 * `hooks` 字段, droid TUI 里显示的 "Hooks UserPromptSubmit · 2 个钩子" 全部来自
 * settings.json;pier 装到 hooks.json 后完全不被 droid 执行(诊断 wrapper 写
 * /tmp 的 echo 都没执行到)。官方文档说 hooks.json 可能是新增位置或文档滞后,
 * 但当前 droid 实际读取的是 settings.json。为保证 pier 集成能真正工作,
 * 回到 settings.json。
 *
 * 官方事件全集(docs.factory.ai 9 事件表):PreToolUse, PostToolUse,
 * UserPromptSubmit, Notification, Stop, SubagentStop, PreCompact,
 * SessionStart, SessionEnd。StopFailure 不在官方表内但本机
 * loomdesk 实装(~/.factory/settings.json)证明 droid 真实支持。
 * matcher 约定:Factory 的 matcher 是正则引擎(非 glob-only), "*" 只是
 * 恰好能匹配任意字符的退化正则写法。
 * 不装 SubagentStop:pier SubagentStop 仅计数不改状态(entry.ts:56,
 * SUBAGENT_EVENTS),安装无害——但 droid 无 SubagentStart 配对,
 * 计数永远为 0, 故仍不装。
 * Notification→PermissionRequest:droid 无独立 PermissionRequest 事件,
 * Notification 是唯一授权信号(本机 ~/.factory/settings.json
 * loomdesk/superset 实装先例)。
 * StopFailure→error:API 错误导致回合终止(loomdesk 实装先例)。
 * 装 SessionEnd(官方真实存在)与 PreCompact(compact 期间避免状态显示为空闲)。
 */
const droidConfigPath = () => join(homedir(), ".factory", "settings.json");
/** 上一波误装的位置(pier 曾写 hooks.json)——遗留清理用。 */
const droidLegacyConfigPath = () => join(homedir(), ".factory", "hooks.json");

async function cleanupDroidLegacy(): Promise<void> {
  if (!existsSync(droidLegacyConfigPath())) {
    return;
  }
  await transformJsonConfig(
    droidLegacyConfigPath(),
    withoutPierNestedHooks,
    "droid-legacy"
  );
}

const DROID_SPEC: NestedJsonIntegrationSpec = {
  agentId: "droid",
  capability: "full",
  configPath: droidConfigPath,
  detect: () => existsSync(droidConfigPath()) || commandExistsOnPath("droid"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "Notification", pierEvent: "PermissionRequest" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "StopFailure", pierEvent: "error" },
    { nativeEvent: "PreCompact", pierEvent: "processing" },
    { matcher: "*", nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { matcher: "*", nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
  ],
};

const droidBase = createNestedJsonIntegration(DROID_SPEC);

export const droidIntegration: typeof droidBase = {
  ...droidBase,
  install: async () => {
    await cleanupDroidLegacy();
    await droidBase.install();
  },
  uninstall: async () => {
    await cleanupDroidLegacy();
    await droidBase.uninstall();
  },
};
