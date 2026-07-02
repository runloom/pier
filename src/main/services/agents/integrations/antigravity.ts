import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  transformJsonConfig,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

/**
 * Antigravity hook 事件 → pier 事件名。
 *
 * 信源：官方 changelog/issue 汇证（medium-high confidence——Antigravity
 * 未完全公开 hook schema 文档，以下依据 changelog 与社区 issue 交叉验证）。
 *
 * 配置文件：~/.gemini/config/hooks.json（orca 的判断是对的：Antigravity
 * 基于 Gemini 衍生，沿用 Gemini 的 hooks 配置路径；loomdesk 参考实现把它
 * 当作未注册模块 / 使用 ~/.antigravity/settings.json 是错的，此前版本沿
 * 用了 loomdesk 的错误路径，现已改正）。
 *
 * schema 形状：官方未完全公开，采用与 claude 家族一致的嵌套 hooks 标准形
 * （{Event: [{matcher?, hooks:[{type,command}]}]}）。不采用 orca bundle
 * 观察到的 'pier-status': {Event: definition} 扁平键形——那是 orca 自己
 * 管理文件的内部约定，不代表 Antigravity 原生 schema。
 *
 * 官方五核心检查点（changelog + issue 汇证）：
 * - PreInvocation：一轮 agent 交互开始（映射 PromptSubmit）。
 * - PostToolUse：工具调用结束（映射 ToolComplete）。
 * - Stop：会话/回合停止（映射 Stop）。
 * - PostInvocation：一轮 agent 交互结束——与 Stop 语义高度重叠（都在回合
 *   结束时触发），为避免同一时刻产生两条 Stop 事件（重复上报/状态抖动），
 *   保守选择不安装 PostInvocation，仅在此注释说明其存在与语义，待未来
 *   有更明确的信源区分二者触发时机差异后再考虑启用。
 *
 * !!! 安全红线（真实且危险）!!!
 * 绝对不要给 Antigravity 装 `PreToolUse` 这个原生事件键。cmux#4768 记录
 * 了一起生产事故：`PreToolUse` 在 Antigravity（及其上游 Gemini 系）里是
 * 阻塞式权限判定 hook——hook 的返回值决定工具调用是否被放行。Pier 的 hook
 * 是纯观测型、尾部 `|| true`，但只要挂在这个键上就会在用户的工具调用链路
 * 里插入一个额外的阻塞点，轻则拖慢、重则在网络异常时卡死工具执行。我们
 * 通过 PostToolUse（非阻塞观测点）拿到等价的"工具已开始/已完成"可见性，
 * 不需要触碰 PreToolUse。任何后续修改这份 spec 的人，都不允许新增一条
 * `nativeEvent: "PreToolUse"` 的映射。
 *
 * 删除 Notification→PermissionRequest：无确证信源支撑这条映射的存在，
 * 已移除。
 */
const antigravityConfigDir = () => join(homedir(), ".gemini", "config");
const antigravityConfigPath = () => join(antigravityConfigDir(), "hooks.json");

const ANTIGRAVITY_SPEC: NestedJsonIntegrationSpec = {
  agentId: "antigravity",
  capability: "full",
  configPath: antigravityConfigPath,
  detect: () =>
    existsSync(antigravityConfigDir()) ||
    existsSync(join(homedir(), ".antigravity")) ||
    commandExistsOnPath("antigravity"),
  events: [
    { nativeEvent: "PreInvocation", pierEvent: "PromptSubmit" },
    { matcher: "*", nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
  ],
  // Antigravity 从 Gemini 衍生, timeout 字段单位继承为**毫秒**（Gemini 官方
  // docs/hooks/index.md 明确 timeout number in milliseconds, default 60000）。
  // 工厂默认的秒制 5 会被 Antigravity 当作 5ms 立刻 kill hook, 必须显式
  // 覆盖到 5000ms。
  timeoutSeconds: 5000,
};

export const antigravityIntegration =
  createNestedJsonIntegration(ANTIGRAVITY_SPEC);

/** 兼容导出（既有测试/调用方使用；语义与工厂一致）。 */
export function withPierAntigravityHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withPierNestedHooks(settings, ANTIGRAVITY_SPEC);
}

export function withoutPierAntigravityHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(settings);
}

export async function installAntigravityHooks(
  settingsPath: string = ANTIGRAVITY_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(
    settingsPath,
    withPierAntigravityHooks,
    "antigravity"
  );
}

export async function uninstallAntigravityHooks(
  settingsPath: string = ANTIGRAVITY_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(
    settingsPath,
    withoutPierAntigravityHooks,
    "antigravity"
  );
}
