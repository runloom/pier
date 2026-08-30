import { isAbsolute, join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { McpConfigFormat } from "./parse-server-names.ts";

/**
 * One MCP config location an agent recognizes (skills `discoveryRoots` /
 * `userDiscoveryRoots` parallel). Project paths are repo-relative; user
 * paths are `~`-relative (resolved under `homedir()` unless `homeEnv`).
 */
export interface McpConfigLocation {
  /**
   * When `homeEnv` is set and present, join that root with this relative
   * path instead of `path` under homedir (CODEX_HOME / GROK_HOME / XDG).
   */
  envRelative?: string;
  format: McpConfigFormat;
  /** Product home override (`CODEX_HOME`, `GROK_HOME`, `XDG_CONFIG_HOME`, …). */
  homeEnv?: string;
  /**
   * Prefer a `.jsonc` sibling when it exists (OpenCode / Kilo / Crush):
   * writing `.json` would be ignored.
   */
  jsoncSibling?: boolean;
  /** Project-relative (`scope=project`) or `~`-relative (`scope=user`). */
  path: string;
  scope: "project" | "user";
}

/**
 * MCP discovery adapter — **one row per AgentKind**, same shape as skills
 * `SkillDiscoveryAdapter`. Adding a new agent = append a row (consuming or
 * explicit non-support). Memory global registration is derived from
 * consuming adapters' first `userConfigs` entry — not a parallel allowlist.
 */
export interface McpDiscoveryAdapter {
  agentKind: AgentKind;
  /**
   * When false, no catalog participation and no pier-memory write.
   * Must still be listed so adding an AgentKind without an MCP decision
   * fails the completeness governance test.
   */
  consumesMcp: boolean;
  officialDocsUrl: string;
  /** Project-scoped MCP config files this agent reads. */
  projectConfigs: readonly McpConfigLocation[];
  /**
   * User-scoped (`~`) MCP config files this agent reads. Catalog 只读发现;
   * 写入方是 agent-managed-assets(pier-memory 全局注册,
   * merge-don't-clobber + 指纹归属),不经本模块。记忆只写 **第一条**
   * userConfig(各智能体原生路径);交叉复用路径留给发现,不重复写入。
   */
  userConfigs: readonly McpConfigLocation[];
  verifiedOn: string;
}

export function mcpProject(
  path: string,
  format: McpConfigFormat = "json-mcp-servers"
): McpConfigLocation {
  return { format, path, scope: "project" };
}

export function mcpUser(
  path: string,
  format: McpConfigFormat = "json-mcp-servers",
  extra?: Pick<McpConfigLocation, "envRelative" | "homeEnv" | "jsoncSibling">
): McpConfigLocation {
  return { format, path, scope: "user", ...extra };
}

const ENV_HOME_FALLBACK: Readonly<Record<string, string>> = {
  CLINE_DIR: ".cline",
  CODEX_HOME: ".codex",
  GROK_HOME: ".grok",
  KIMI_CODE_HOME: ".kimi-code",
  XDG_CONFIG_HOME: ".config",
};

function expandEnvHome(
  raw: string | undefined,
  home: string,
  fallbackRel: string
): string {
  if (!raw) {
    return join(home, fallbackRel);
  }
  if (raw === "~") {
    return home;
  }
  if (raw.startsWith("~/")) {
    return join(home, raw.slice(2));
  }
  return isAbsolute(raw) ? raw : join(home, fallbackRel);
}

/** User MCP path: `homeEnv`/`envRelative` when set, otherwise `path` under home. */
export function resolveMcpUserConfigPath(
  loc: McpConfigLocation,
  home: string,
  env: NodeJS.ProcessEnv
): string {
  const rel = loc.path.replace(/^~\//u, "");
  if (loc.homeEnv && loc.envRelative) {
    const fallback = ENV_HOME_FALLBACK[loc.homeEnv] ?? rel.split("/")[0] ?? "";
    const root = expandEnvHome(env[loc.homeEnv], home, fallback);
    return join(root, loc.envRelative);
  }
  return join(home, ...rel.split("/"));
}
