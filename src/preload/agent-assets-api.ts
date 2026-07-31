import type {
  AgentMcpPathActionResult,
  AssetRootRef,
  McpCatalogSnapshot,
  RuleFileId,
  RulesReadResult,
  RulesSnapshot,
} from "@shared/contracts/agent/assets.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierAgentAssetsAPI {
  mcp: {
    catalog(root: AssetRootRef): Promise<McpCatalogSnapshot>;
    open(
      root: AssetRootRef,
      entryId: string
    ): Promise<AgentMcpPathActionResult>;
    reveal(
      root: AssetRootRef,
      entryId: string
    ): Promise<AgentMcpPathActionResult>;
  };
  rules: {
    ensure(root: AssetRootRef, id: RuleFileId): Promise<RulesSnapshot>;
    read(root: AssetRootRef, id: RuleFileId): Promise<RulesReadResult>;
    snapshot(root: AssetRootRef): Promise<RulesSnapshot>;
    write(
      root: AssetRootRef,
      id: RuleFileId,
      content: string
    ): Promise<RulesSnapshot>;
  };
}

export const agentAssetsApi: PierAgentAssetsAPI = {
  mcp: {
    catalog: (root) =>
      invokePierCommand<McpCatalogSnapshot>({
        root,
        type: "agentMcp.catalog",
      }),
    open: (root, entryId) =>
      invokePierCommand<AgentMcpPathActionResult>({
        entryId,
        root,
        type: "agentMcp.open",
      }),
    reveal: (root, entryId) =>
      invokePierCommand<AgentMcpPathActionResult>({
        entryId,
        root,
        type: "agentMcp.reveal",
      }),
  },
  rules: {
    ensure: (root, id) =>
      invokePierCommand<RulesSnapshot>({
        id,
        root,
        type: "rules.ensure",
      }),
    read: (root, id) =>
      invokePierCommand<RulesReadResult>({
        id,
        root,
        type: "rules.read",
      }),
    snapshot: (root) =>
      invokePierCommand<RulesSnapshot>({
        root,
        type: "rules.snapshot",
      }),
    write: (root, id, content) =>
      invokePierCommand<RulesSnapshot>({
        content,
        id,
        root,
        type: "rules.write",
      }),
  },
};
