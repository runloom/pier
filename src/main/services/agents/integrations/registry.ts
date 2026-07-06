import { aiderIntegration } from "./aider.ts";
import { ampIntegration } from "./amp.ts";
import { antigravityIntegration } from "./antigravity.ts";
import { augIntegration } from "./aug.ts";
import { autohandIntegration } from "./autohand.ts";
import { claudeIntegration } from "./claude.ts";
import { clineIntegration } from "./cline.ts";
import { codebuddyIntegration } from "./codebuddy.ts";
import { codexIntegration } from "./codex.ts";
import { commandCodeIntegration } from "./command-code.ts";
import { copilotIntegration } from "./copilot.ts";
import { crushIntegration } from "./crush.ts";
import { cursorIntegration } from "./cursor.ts";
import { devinIntegration } from "./devin.ts";
import { droidIntegration } from "./droid.ts";
import { geminiIntegration } from "./gemini.ts";
import { gooseIntegration } from "./goose.ts";
import { grokIntegration } from "./grok.ts";
import { hermesIntegration } from "./hermes.ts";
import { kiloIntegration } from "./kilo.ts";
import { kimiIntegration } from "./kimi.ts";
import { kiroIntegration } from "./kiro.ts";
import { mimoCodeIntegration } from "./mimo-code.ts";
import { mistralVibeIntegration } from "./mistral-vibe.ts";
import { ompIntegration } from "./omp.ts";
import { openclaudeIntegration } from "./openclaude.ts";
import { opencodeIntegration } from "./opencode.ts";
import { piIntegration } from "./pi.ts";
import { qodercliIntegration } from "./qodercli.ts";
import { qwenCodeIntegration } from "./qwen-code.ts";
import type { AgentHookIntegration } from "./types.ts";

/**
 * 已接入的 agent hook 集成注册表。适配器彼此独立（各管各的配置文件）,
 * 新增 agent = 新增一个 integrations/<agent>.ts + 此处一行。
 */
export const AGENT_HOOK_INTEGRATIONS: readonly AgentHookIntegration[] = [
  aiderIntegration,
  ampIntegration,
  antigravityIntegration,
  augIntegration,
  autohandIntegration,
  claudeIntegration,
  codebuddyIntegration,
  clineIntegration,
  codexIntegration,
  commandCodeIntegration,
  copilotIntegration,
  crushIntegration,
  cursorIntegration,
  devinIntegration,
  droidIntegration,
  geminiIntegration,
  gooseIntegration,
  grokIntegration,
  hermesIntegration,
  kiloIntegration,
  kimiIntegration,
  kiroIntegration,
  mimoCodeIntegration,
  mistralVibeIntegration,
  ompIntegration,
  opencodeIntegration,
  openclaudeIntegration,
  piIntegration,
  qodercliIntegration,
  qwenCodeIntegration,
];

/**
 * 幂等安装全部已检测到的集成。单个失败不影响其他（逐个隔离告警）——
 * 一家 agent 的配置异常不应拖垮整个状态功能。
 */
export async function installAllAgentHooks(): Promise<void> {
  await Promise.allSettled(
    AGENT_HOOK_INTEGRATIONS.map(async (integration) => {
      if (!integration.detect()) {
        return;
      }
      try {
        await integration.install();
      } catch (err) {
        console.warn(`[agent-hooks:${integration.id}] install failed:`, err);
      }
    })
  );
}

/**
 * 卸载全部集成。不设 detect 门控——二进制已卸但配置残留时也要能清干净；
 * 对从未安装过的目标, 变换无变化不落盘, 零副作用。
 */
export async function uninstallAllAgentHooks(): Promise<void> {
  await Promise.allSettled(
    AGENT_HOOK_INTEGRATIONS.map(async (integration) => {
      try {
        await integration.uninstall();
      } catch (err) {
        console.warn(`[agent-hooks:${integration.id}] uninstall failed:`, err);
      }
    })
  );
}

export async function applyAgentStatusHooksPreference(
  enabled: boolean
): Promise<void> {
  await (enabled ? installAllAgentHooks() : uninstallAllAgentHooks());
}
