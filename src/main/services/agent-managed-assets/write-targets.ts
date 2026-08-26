import type { AgentKind } from "@shared/contracts/agent.ts";

export type MemoryConfigFormat =
  | "mcp-servers-json"
  | "opencode-json"
  | "codex-toml";

export interface MemoryWriteTarget {
  format: MemoryConfigFormat;
  relativePath: string;
}

/**
 * 每个智能体唯一首选项目配置（spec「写入目标与选择规则」）；
 * 实际写入集合 = 已安装智能体首选目标的去重并集。
 */
const TARGETS_BY_AGENT: Partial<Record<AgentKind, MemoryWriteTarget>> = {
  claude: { format: "mcp-servers-json", relativePath: ".mcp.json" },
  omp: { format: "mcp-servers-json", relativePath: ".mcp.json" },
  cursor: { format: "mcp-servers-json", relativePath: ".cursor/mcp.json" },
  codex: { format: "codex-toml", relativePath: ".codex/config.toml" },
  gemini: { format: "mcp-servers-json", relativePath: ".gemini/settings.json" },
  opencode: { format: "opencode-json", relativePath: "opencode.json" },
};

export interface SelectedMemoryTarget extends MemoryWriteTarget {
  consumers: AgentKind[];
}

export function selectMemoryTargets(
  installedAgents: readonly AgentKind[]
): SelectedMemoryTarget[] {
  const byPath = new Map<string, SelectedMemoryTarget>();
  for (const agent of installedAgents) {
    const target = TARGETS_BY_AGENT[agent];
    if (!target) {
      continue;
    }
    const existing = byPath.get(target.relativePath);
    if (existing) {
      existing.consumers.push(agent);
      continue;
    }
    byPath.set(target.relativePath, {
      consumers: [agent],
      format: target.format,
      relativePath: target.relativePath,
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}
