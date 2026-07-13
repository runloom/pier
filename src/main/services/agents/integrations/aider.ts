import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  pierBlockMarkers,
  removePierTextBlock,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "aider";

/**
 * Aider 集成——已退役, 仅保留清理路径。
 *
 * 退役理由：aider 上游仅暴露 `notifications-command` 一个粗信号
 * （aider.chat/docs/usage/notifications.html）, 映射到 pier 的 Stop。
 * Stop 不在 SESSION_CREATING_EVENTS 集（SessionStart/PromptSubmit/
 * ToolStart/PermissionRequest）, 意味着 hook 层永远建不起来——
 * 所有 Stop 事件被聚合器的 ghost gate 静默丢弃, 集成是死代码。
 *
 * 而人为合成 SessionStart 以激活 hook 层会制造 false-idle（假 ready）:
 * Stop 让状态置 ready + 吸收, 之后的工具事件全被吃掉, 用户看到
 * "等待输入"而实际 agent 正在工作。这正是本次审计要消灭的谎报方向。
 * 不变式：宁无信号（false-busy, 危害小）不假 ready（false-idle）。
 *
 * launch 先验层已提供品牌图标与基础 processing 状态, 无 hook 集成
 * 不影响用户体验, 只是缺少回合结束的 ready 信号——可接受的退化。
 *
 * install() 现在仅清理历史安装的 pier 托管块（与 uninstall 行为一致）,
 * 不再写入新的 notifications-command 配置。
 */

export function aiderConfigPath(): string {
  return join(homedir(), ".aider.conf.yml");
}

export function aiderDetect(): boolean {
  return existsSync(aiderConfigPath()) || commandExistsOnPath("aider");
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

/**
 * 唯一实现：清理历史 pier 托管块。退役后 install ≡ uninstall ≡ 本函数
 * （见文件头退役理由）；幂等：无块时不落盘。
 */
async function cleanupAiderHooks(configPath: string): Promise<void> {
  const raw = await readConfigRaw(configPath);
  const next = withoutPierAiderNotifications(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export async function installAiderHooks(
  configPath: string = aiderConfigPath()
): Promise<void> {
  await cleanupAiderHooks(configPath);
}

export async function uninstallAiderHooks(
  configPath: string = aiderConfigPath()
): Promise<void> {
  await cleanupAiderHooks(configPath);
}

export const aiderIntegration: AgentHookIntegration = {
  capability: "coarse",
  detect: aiderDetect,
  id: AGENT_ID,
  runtime: { stopAuthority: "none" },
  install: () => installAiderHooks(),
  uninstall: () => uninstallAiderHooks(),
};

/** marker 常量导出（测试断言块边界用）。 */
export const AIDER_BLOCK_MARKERS = pierBlockMarkers(AGENT_ID);
