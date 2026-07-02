import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  type NestedHookEventSpec,
  readJsonConfig,
  removePierTextBlock,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "goose";

/**
 * goose 官方（block/goose，现 aaif-goose/goose，PR#9093 "feat: Hooks"）
 * 走 **Open Plugins** 规范（https://open-plugins.com/agent-builders/
 * components/hooks），不读旧实现写入的顶层 `hooks:` YAML 键——那是死配置。
 * 真实载体是插件包：
 * - `~/.agents/plugins/pier/plugin.json`（manifest, 仅 name/version/
 *   description 三字段, PR examples/plugins/hello-hooks/plugin.json 同款）
 * - `~/.agents/plugins/pier/hooks/hooks.json`（嵌套 Claude 式 schema：
 *   `{hooks:{Event:[{matcher?, hooks:[{type:"command",command}]}]}}`,
 *   crates/goose/src/hooks/mod.rs 顶部文档注释与 hello-hooks 示例双重
 *   确认）——与 shared.ts 的 withPierNestedHooks 结构完全一致, 直接复用。
 * - 事件名（crates/goose/src/hooks/mod.rs `enum HookEvent`, PascalCase,
 *   `name()`/`from_name()` 双向映射确认）：SessionStart、SessionEnd、
 *   UserPromptSubmit、PreToolUse、PostToolUse、PostToolUseFailure、Stop
 *   （另有 BeforeReadFile/AfterFileEdit/BeforeShellExecution/
 *   AfterShellExecution, pier 暂不用）。capability 因此升级为 "full"
 *   （旧实现仅接 2 个工具事件, 定级 "coarse" 已过时）。
 * - 插件发现路径：`~/.agents/plugins/<name>/`（用户级）或
 *   `<project>/.agents/plugins/<name>/`（项目级）——本集成仅装用户级,
 *   与其余 pier agent 集成的落盘惯例一致。
 * - 禁用清单：`~/.config/goose/settings.json` 的 `disabledPlugins`
 *   字符串数组（crates/goose/.../discovery.rs `disabled_plugins` 字段,
 *   PR README "To turn the plugin off, add it to disabledPlugins in
 *   ~/.config/goose/settings.json" 确认）——若含 "pier", install 直接
 *   跳过并告警（用户显式关闭, 不应静默覆盖）。
 */

const GOOSE_HOOK_EVENTS: readonly NestedHookEventSpec[] = [
  { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
  { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
  { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
  { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
  { nativeEvent: "PostToolUseFailure", pierEvent: "ToolComplete" },
  { nativeEvent: "Stop", pierEvent: "Stop" },
];

const PLUGIN_NAME = "pier";
const PLUGIN_VERSION = "1.0.0";
const PLUGIN_DESCRIPTION =
  "Pier agent status reporting hooks (managed by Pier; do not edit).";

/** 托管标记：写在 plugin.json 的 description 字段内, install 幂等比对 + uninstall 删除前必查。 */
const PLUGIN_MARKER = "managed by Pier";

export function goosePluginDir(): string {
  return join(homedir(), ".agents", "plugins", PLUGIN_NAME);
}

function gooseHooksJsonPath(): string {
  return join(goosePluginDir(), "hooks", "hooks.json");
}

export function gooseSettingsPath(): string {
  return join(homedir(), ".config", "goose", "settings.json");
}

/** 旧实现遗留的死配置路径（顶层 `hooks:` YAML 键, goose 从不读取）。 */
export function legacyGooseConfigPath(): string {
  return join(homedir(), ".config", "goose", "config.yaml");
}

export function gooseDetect(): boolean {
  return commandExistsOnPath("goose");
}

/**
 * `~/.config/goose/settings.json` 的 `disabledPlugins` 是否包含 "pier"
 * （用户显式关闭本插件）。settings.json 不存在或损坏均视为未禁用。
 */
export async function isPierPluginDisabled(
  settingsPath: string = gooseSettingsPath()
): Promise<boolean> {
  const settings = await readJsonConfig(settingsPath);
  if (settings === null) {
    return false;
  }
  const disabled = settings.disabledPlugins;
  return Array.isArray(disabled) && disabled.includes(PLUGIN_NAME);
}

export function buildGoosePluginManifest(): string {
  return `${JSON.stringify(
    {
      description: `${PLUGIN_DESCRIPTION} (${PLUGIN_MARKER})`,
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
    },
    null,
    2
  )}\n`;
}

/** 纯函数：注入 pier hook 条目到 hooks.json 内容（幂等——先剔旧再加新）。 */
export function withPierGooseHooks(
  hooksJson: Record<string, unknown>
): Record<string, unknown> {
  return withPierNestedHooks(hooksJson, {
    agentId: AGENT_ID,
    capability: "full",
    configPath: gooseHooksJsonPath,
    events: GOOSE_HOOK_EVENTS,
  });
}

/** 纯函数：移除 pier hook 条目；无匹配条目时原样返回输入引用。 */
export function withoutPierGooseHooks(
  hooksJson: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(hooksJson);
}

function isManagedManifest(content: string): boolean {
  return content.includes(PLUGIN_MARKER);
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readJsonFile(
  path: string
): Promise<Record<string, unknown> | null> {
  const raw = await readTextFile(path);
  if (raw === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * install：settings.json 的 disabledPlugins 含 "pier" 时跳过并告警；
 * 否则部署/更新 plugin.json（非托管同名文件绝不覆盖）+ hooks/hooks.json
 * （幂等去重）。同时清理旧实现写入 config.yaml 的 pier marker 块（死
 * 配置, goose 从不读取顶层 hooks:）。
 */
export async function installGooseHooks(
  pluginDir: string = goosePluginDir(),
  settingsPath: string = gooseSettingsPath()
): Promise<void> {
  if (!gooseDetect()) {
    return;
  }
  if (await isPierPluginDisabled(settingsPath)) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] plugin disabled via disabledPlugins in settings.json, skip install:`,
      settingsPath
    );
    return;
  }

  const manifestPath = join(pluginDir, "plugin.json");
  const existingManifest = await readTextFile(manifestPath);
  if (existingManifest !== null && !isManagedManifest(existingManifest)) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] unmanaged plugin manifest present, skip install:`,
      manifestPath
    );
    return;
  }
  const nextManifest = buildGoosePluginManifest();
  if (existingManifest !== nextManifest) {
    await mkdir(pluginDir, { recursive: true });
    await atomicWriteFile(manifestPath, nextManifest);
  }

  const hooksJsonPath = join(pluginDir, "hooks", "hooks.json");
  const hooksJson = await readJsonFile(hooksJsonPath);
  if (hooksJson === null) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] hooks.json unparsable, skip:`,
      hooksJsonPath
    );
  } else {
    const next = withPierGooseHooks(hooksJson);
    if (
      next !== hooksJson &&
      JSON.stringify(next) !== JSON.stringify(hooksJson)
    ) {
      await atomicWriteFile(
        hooksJsonPath,
        `${JSON.stringify(next, null, 2)}\n`
      );
    }
  }

  await cleanupLegacyGooseConfig();
}

/**
 * uninstall：撤销 hooks.json 内的 pier 条目；删除托管 plugin.json（先查
 * marker 再删, 非托管文件绝不删除）——manifest 一删, 整个 pier 插件目录
 * 即失效, 一并清理 hooks/ 子目录。同时清理旧实现的 config.yaml 遗留块。
 */
export async function uninstallGooseHooks(
  pluginDir: string = goosePluginDir()
): Promise<void> {
  const hooksJsonPath = join(pluginDir, "hooks", "hooks.json");
  const hooksJson = await readJsonFile(hooksJsonPath);
  if (hooksJson !== null) {
    const next = withoutPierGooseHooks(hooksJson);
    if (
      next !== hooksJson &&
      JSON.stringify(next) !== JSON.stringify(hooksJson)
    ) {
      await atomicWriteFile(
        hooksJsonPath,
        `${JSON.stringify(next, null, 2)}\n`
      );
    }
  }

  const manifestPath = join(pluginDir, "plugin.json");
  const existingManifest = await readTextFile(manifestPath);
  if (existingManifest === null) {
    await cleanupLegacyGooseConfig();
    return;
  }
  if (!isManagedManifest(existingManifest)) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] unmanaged plugin manifest present, skip uninstall:`,
      manifestPath
    );
    await cleanupLegacyGooseConfig();
    return;
  }
  await rm(pluginDir, { force: true, recursive: true });
  await cleanupLegacyGooseConfig();
}

/**
 * 遗留清理：旧实现向 `~/.config/goose/config.yaml` 注入的顶层 `hooks:`
 * pier marker 块从未被 goose 读取（真实机制是插件包）, 属于死配置——若
 * 存在则移除。
 */
export async function cleanupLegacyGooseConfig(
  configPath: string = legacyGooseConfigPath()
): Promise<void> {
  const raw = await readTextFile(configPath);
  if (raw === null) {
    return;
  }
  const next = removePierTextBlock(raw, AGENT_ID);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export const gooseIntegration: AgentHookIntegration = {
  capability: "full",
  detect: gooseDetect,
  id: AGENT_ID,
  install: () => installGooseHooks(),
  uninstall: () => uninstallGooseHooks(),
};

/** marker 常量导出（测试断言用）。 */
export const GOOSE_PLUGIN_MARKER_TEXT = PLUGIN_MARKER;
export const GOOSE_PLUGIN_NAME = PLUGIN_NAME;
