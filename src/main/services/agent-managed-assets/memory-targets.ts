import { homedir } from "node:os";
import {
  MCP_DISCOVERY_ADAPTERS,
  resolveMcpUserConfigPath,
} from "@main/services/agent-mcp-catalog/adapters.ts";
import type { McpConfigFormat } from "@main/services/agent-mcp-catalog/parse-server-names.ts";
import {
  buildCopilotLauncherEntry,
  buildGooseLauncherEntry,
  buildLauncherEntry,
  buildOpenCodeLauncherEntry,
  buildRovoLauncherEntry,
  type MemoryConfigFormat,
} from "./serializers.ts";

export interface MemoryGlobalTarget {
  abs: string;
  consumers: readonly string[];
  entry: (launcherPath: string) => Record<string, unknown>;
  format: MemoryConfigFormat;
  jsoncSibling: boolean;
}

export function memoryFormatFor(
  format: McpConfigFormat
): MemoryConfigFormat | null {
  switch (format) {
    case "opencode-json":
      return "opencode-json";
    case "codex-toml":
      return "codex-toml";
    case "vibe-toml":
      return "vibe-toml";
    case "goose-yaml":
      return "goose-yaml";
    case "hermes-yaml":
      return "hermes-yaml";
    case "amp-settings-json":
      return "amp-settings-json";
    case "json-mcp-servers":
    case "claude-user-json":
      return "mcp-servers-json";
    default:
      return null;
  }
}

function launcherFor(format: MemoryConfigFormat, agentKind: string) {
  if (format === "opencode-json") {
    return buildOpenCodeLauncherEntry;
  }
  if (format === "goose-yaml") {
    return buildGooseLauncherEntry;
  }
  if (agentKind === "copilot") {
    return buildCopilotLauncherEntry;
  }
  if (agentKind === "rovo") {
    return buildRovoLauncherEntry;
  }
  return buildLauncherEntry;
}

/**
 * v3 全局注册目标 = consuming MCP 适配器的 **第一条** userConfig 去重并集。
 * 已装智能体才写入;同路径多消费者合并一次。新增智能体只需在 adapter-facts
 * 登记,不必再改这份名单。
 */
export function memoryGlobalTargets(options?: {
  env?: NodeJS.ProcessEnv;
  home?: string;
}): MemoryGlobalTarget[] {
  const home = options?.home ?? homedir();
  const env = options?.env ?? process.env;
  const byAbs = new Map<string, MemoryGlobalTarget>();
  for (const adapter of MCP_DISCOVERY_ADAPTERS) {
    if (!adapter.consumesMcp) {
      continue;
    }
    const preferred = adapter.userConfigs[0];
    if (!preferred) {
      continue;
    }
    const format = memoryFormatFor(preferred.format);
    if (!format) {
      continue;
    }
    const abs = resolveMcpUserConfigPath(preferred, home, env);
    const existing = byAbs.get(abs);
    if (existing) {
      if (!existing.consumers.includes(adapter.agentKind)) {
        byAbs.set(abs, {
          ...existing,
          consumers: [...existing.consumers, adapter.agentKind],
        });
      }
      continue;
    }
    byAbs.set(abs, {
      abs,
      consumers: [adapter.agentKind],
      entry: launcherFor(format, adapter.agentKind),
      format,
      jsoncSibling: preferred.jsoncSibling === true,
    });
  }
  return [...byAbs.values()];
}
