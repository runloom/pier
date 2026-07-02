import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  pierBlockMarkers,
  pierHookCommand,
  removePierTextBlock,
  upsertPierTextBlock,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "aider";

/**
 * Aider notifications — 依据官方文档 aider.chat/docs/usage/notifications.html
 * （并以 aider.chat/docs/config/aider_conf.html 的示例 YAML 核实键名拼写）：
 * - 仅一个粗信号：`notifications-command`（连字符, 非下划线——
 *   aider_conf.html 示例文件内两个键均为连字符：`notifications` /
 *   `notifications-command`；CLI flag 与环境变量形式才是下划线/大写
 *   风格 `--notifications-command` / `AIDER_NOTIFICATIONS_COMMAND`，
 *   YAML 配置键本身用连字符）。
 * - 触发时机：LLM 结束生成、等待用户输入时触发（无 payload，命令本身是
 *   固定字符串, 无法携带事件相关的动态数据——这与 kiro/cline/kilo 的
 *   JSON payload 机制完全不同）。
 * - 载体：`~/.aider.conf.yml`（官方 YAML 配置, 与 CLI flag/环境变量三选一
 *   等效, 这里选 YAML 是因为它是持久化的全局配置文件, 符合 pier
 *   一次安装全局生效的纪律）。
 *
 * capability "coarse"：无法区分工具调用/权限请求/会话边界, 只有「回合
 * 结束、等待下一次输入」这一粗粒度信号。标题启发式（进程输出扫描）
 * 仍是 processing 态的主要来源, 本集成只补一个可靠的回合结束信号
 * （Stop 事件), 不冒充更细粒度的状态。
 *
 * YAML 处理：不引入 YAML 解析器, 文本级保守编辑（goose 同款 marker 块
 * 追加/删除手法）——只在文件末尾追加 marker 包裹的两行, 卸载删除整块。
 * **用户已有自定义 notifications 相关键时绝不覆盖**：检测顶层
 * （无缩进行首）是否已存在 `notifications:` 或 `notifications-command:`
 * 键（marker 块之外), 命中则跳过安装并 warn。卸载时只删 pier 管理的
 * marker 块, 不触碰用户自己写的 notifications 配置。
 */

const TOP_LEVEL_NOTIFICATIONS_KEY_RE = /^notifications(-command)?:\s*/m;

export function aiderConfigPath(): string {
  return join(homedir(), ".aider.conf.yml");
}

export function aiderDetect(): boolean {
  return existsSync(aiderConfigPath()) || commandExistsOnPath("aider");
}

/**
 * 用户文件是否已有非 pier 管理的顶层 `notifications:` /
 * `notifications-command:` 键（marker 块外）。检测方法：剔除 pier
 * marker 块后的剩余文本中是否仍匹配这两个顶层键。
 */
export function hasForeignNotificationsKey(raw: string): boolean {
  const withoutPierBlock = removePierTextBlock(raw, AGENT_ID);
  return TOP_LEVEL_NOTIFICATIONS_KEY_RE.test(withoutPierBlock);
}

/**
 * marker 块内容：仅 Stop→pier "Stop" 一个事件（回合结束≈等待输入）。
 * command 值用单引号 YAML 字面量承载（goose 同款理由：pierHookCommand
 * 内含双引号转义与 `$`，双引号 YAML 字符串会触发二次转义；命令文本本身
 * 不含单引号, 单引号字面量无需转义即可安全嵌入）。
 */
export function buildAiderNotificationsBlock(): string {
  const command = pierHookCommand(AGENT_ID, "Stop");
  const literal = command.replaceAll("'", "''");
  return `notifications: true\nnotifications-command: '${literal}'`;
}

/**
 * 纯函数：注入/替换 pier marker 块。若用户文件已有非 pier 的顶层
 * notifications 相关键，跳过安装并原样返回输入引用（不破坏用户配置
 * 优先，调用方应告警）。
 */
export function withPierAiderNotifications(raw: string): string {
  if (hasForeignNotificationsKey(raw)) {
    return raw;
  }
  return upsertPierTextBlock(raw, AGENT_ID, buildAiderNotificationsBlock());
}

/** 纯函数：移除 pier marker 块；无块时原样返回输入引用。 */
export function withoutPierAiderNotifications(raw: string): string {
  return removePierTextBlock(raw, AGENT_ID);
}

async function readConfigRaw(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function installAiderHooks(
  configPath: string = aiderConfigPath()
): Promise<void> {
  const raw = await readConfigRaw(configPath);
  if (hasForeignNotificationsKey(raw)) {
    console.warn(
      "[agent-hooks:aider] existing notifications config detected, skip install to avoid overriding user setting:",
      configPath
    );
    return;
  }
  const next = withPierAiderNotifications(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export async function uninstallAiderHooks(
  configPath: string = aiderConfigPath()
): Promise<void> {
  const raw = await readConfigRaw(configPath);
  const next = withoutPierAiderNotifications(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export const aiderIntegration: AgentHookIntegration = {
  capability: "coarse",
  detect: aiderDetect,
  id: AGENT_ID,
  install: () => installAiderHooks(),
  uninstall: () => uninstallAiderHooks(),
};

/** marker 常量导出（测试断言块边界用）。 */
export const AIDER_BLOCK_MARKERS = pierBlockMarkers(AGENT_ID);
