import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "kiro";

/**
 * Kiro 默认终端路径没有可证明会被加载的全局 hook 配置。集成仅扫描
 * `~/.kiro/agents/*.json`，移除旧版本曾写入用户自定义智能体的 Pier 条目；
 * install 与 uninstall 都不再创建或注入任何 hook。
 */

interface KiroHookEntry {
  command: string;
}

function isPierKiroEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return isPierHookCommand((entry as KiroHookEntry).command);
}

function hooksRecord(
  agentConfig: Record<string, unknown>
): Record<string, unknown[]> {
  const hooks = agentConfig.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown[]>) };
  }
  return {};
}

/**
 * 纯函数：剔除全部 pier hook 条目, 空事件键一并删除。无 pier 条目时原样
 * 返回输入引用。
 */
export function withoutPierKiroHooks(
  agentConfig: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(agentConfig);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierKiroEntry(entry));
    if (kept.length === entries.length) {
      continue;
    }
    changed = true;
    if (kept.length > 0) {
      hooks[key] = kept;
    } else {
      delete hooks[key];
    }
  }
  if (!changed) {
    return agentConfig;
  }
  return { ...agentConfig, hooks };
}

export function kiroAgentsDir(): string {
  return join(homedir(), ".kiro", "agents");
}

async function listAgentConfigFiles(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(kiroAgentsDir());
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(kiroAgentsDir(), name));
}

export async function installKiroHooks(): Promise<void> {
  const files = await listAgentConfigFiles();
  for (const file of files) {
    await transformJsonConfig(file, withoutPierKiroHooks, AGENT_ID);
  }
}

export async function uninstallKiroHooks(): Promise<void> {
  const files = await listAgentConfigFiles();
  for (const file of files) {
    await transformJsonConfig(file, withoutPierKiroHooks, AGENT_ID);
  }
}

function kiroDetect(): boolean {
  return (
    existsSync(join(homedir(), ".kiro")) || commandExistsOnPath("kiro-cli")
  );
}

export const kiroIntegration: AgentHookIntegration = {
  runtime: {
    emittedMappings: [],
    stopAuthority: "none",
  },
  detect: kiroDetect,
  id: AGENT_ID,
  install: installKiroHooks,
  uninstall: uninstallKiroHooks,
};
