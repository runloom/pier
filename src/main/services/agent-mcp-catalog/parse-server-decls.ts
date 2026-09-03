/**
 * Extract MCP server declarations (name + transport + enabled) from known
 * config shapes. Never returns command/args/env/url/headers payloads.
 */

import type { McpTransport } from "@shared/contracts/agent/assets.ts";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

const MAX_BYTES = 512 * 1024;

/** `[mcp_servers.name]` or `[mcp_servers."name"]` — Codex/Grok user config. */
const CODEX_MCP_SERVER_HEADER =
  /^\[mcp_servers\.(?:"((?:\\.|[^"\\])*)"|([A-Za-z0-9][A-Za-z0-9_-]*))\]/gm;

export type McpConfigFormat =
  | "json-mcp-servers"
  | "claude-user-json"
  | "codex-toml"
  | "opencode-json"
  | "amp-settings-json"
  | "goose-yaml"
  | "hermes-yaml"
  | "vibe-toml";

export interface McpServerDecl {
  enabled: boolean;
  name: string;
  transport: McpTransport;
}

export const MCP_PARSE_MAX_BYTES = MAX_BYTES;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unescapeTomlString(raw: string): string {
  return raw.replace(/\\(["\\])/g, "$1");
}

function pickTransport(a: McpTransport, b: McpTransport): McpTransport {
  if (a === b) return a;
  if (a === "unknown") return b;
  if (b === "unknown") return a;
  return a;
}

function inferTransport(value: unknown): McpTransport {
  if (!isRecord(value)) return "unknown";
  const type = value.type;
  if (
    type === "remote" ||
    type === "http" ||
    type === "sse" ||
    type === "streamable_http" ||
    type === "streamable-http"
  ) {
    return "http";
  }
  if (typeof value.url === "string" && value.url.trim().length > 0) {
    return "http";
  }
  if (typeof value.uri === "string" && value.uri.trim().length > 0) {
    return "http";
  }
  if (type === "local" || type === "stdio") return "stdio";
  if (typeof value.command === "string" && value.command.trim().length > 0) {
    return "stdio";
  }
  if (Array.isArray(value.command) && value.command.length > 0) return "stdio";
  if (typeof value.cmd === "string" && value.cmd.trim().length > 0) {
    return "stdio";
  }
  return "unknown";
}

function inferEnabled(value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (value.enabled === false) return false;
  if (value.disabled === true) return false;
  return true;
}

function declFromEntry(name: string, value: unknown): McpServerDecl | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return {
    enabled: inferEnabled(value),
    name: trimmed,
    transport: inferTransport(value),
  };
}

function mergeDecls(decls: readonly McpServerDecl[]): McpServerDecl[] {
  const byName = new Map<string, McpServerDecl>();
  for (const decl of decls) {
    const prev = byName.get(decl.name);
    if (!prev) {
      byName.set(decl.name, decl);
      continue;
    }
    byName.set(decl.name, {
      enabled: prev.enabled && decl.enabled,
      name: decl.name,
      transport: pickTransport(prev.transport, decl.transport),
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function declsFromMap(value: unknown): McpServerDecl[] {
  if (!isRecord(value)) return [];
  const decls: McpServerDecl[] = [];
  for (const [name, entry] of Object.entries(value)) {
    const decl = declFromEntry(name, entry);
    if (decl) decls.push(decl);
  }
  return decls;
}

function nestedMap(value: unknown, key: string): unknown {
  if (!isRecord(value)) return;
  return value[key];
}

export function parseJsonMcpServerDecls(raw: string): McpServerDecl[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return mergeDecls(declsFromMap(nestedMap(parsed, "mcpServers")));
}

export function parseOpencodeJsonMcpServerDecls(raw: string): McpServerDecl[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return mergeDecls([
    ...declsFromMap(nestedMap(parsed, "mcp")),
    ...declsFromMap(nestedMap(parsed, "mcpServers")),
  ]);
}

export function parseClaudeUserJsonMcpServerDecls(
  raw: string,
  projectRootPath: string | null
): McpServerDecl[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const decls = declsFromMap(parsed.mcpServers);
  if (!projectRootPath) return mergeDecls(decls);
  const projects = parsed.projects;
  if (!isRecord(projects)) return mergeDecls(decls);
  const project = projects[projectRootPath];
  if (isRecord(project)) {
    decls.push(...declsFromMap(project.mcpServers));
  }
  return mergeDecls(decls);
}

export function parseAmpSettingsMcpServerDecls(raw: string): McpServerDecl[] {
  try {
    return mergeDecls(
      declsFromMap(nestedMap(JSON.parse(raw) as unknown, "amp.mcpServers"))
    );
  } catch {
    return [];
  }
}

const GOOSE_MCP_TYPES = new Set([
  "http",
  "local",
  "remote",
  "sse",
  "stdio",
  "streamable-http",
  "streamable_http",
]);

function isGooseMcpExtension(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (type === "builtin" || type === "platform") return false;
  if (typeof type === "string" && type.length > 0) {
    return GOOSE_MCP_TYPES.has(type);
  }
  return true;
}

export function parseGooseYamlMcpServerDecls(raw: string): McpServerDecl[] {
  try {
    const map = nestedMap(parseYaml(raw), "extensions");
    if (!isRecord(map)) return [];
    const decls: McpServerDecl[] = [];
    for (const [name, entry] of Object.entries(map)) {
      if (!isGooseMcpExtension(entry)) continue;
      const decl = declFromEntry(name, entry);
      if (decl) decls.push(decl);
    }
    return mergeDecls(decls);
  } catch {
    return [];
  }
}

export function parseHermesYamlMcpServerDecls(raw: string): McpServerDecl[] {
  try {
    return mergeDecls(declsFromMap(nestedMap(parseYaml(raw), "mcp_servers")));
  } catch {
    return [];
  }
}

function parseCodexTomlNamesFallback(raw: string): McpServerDecl[] {
  const decls: McpServerDecl[] = [];
  CODEX_MCP_SERVER_HEADER.lastIndex = 0;
  for (const match of raw.matchAll(CODEX_MCP_SERVER_HEADER)) {
    const quoted = match[1];
    const bare = match[2];
    let name = "";
    if (typeof quoted === "string") {
      name = unescapeTomlString(quoted);
    } else if (typeof bare === "string") {
      name = bare;
    }
    const decl = declFromEntry(name, undefined);
    if (decl) decls.push(decl);
  }
  return mergeDecls(decls);
}

export function parseCodexTomlMcpServerDecls(raw: string): McpServerDecl[] {
  try {
    const parsed: unknown = parseToml(raw);
    const map = nestedMap(parsed, "mcp_servers");
    if (isRecord(map)) return mergeDecls(declsFromMap(map));
  } catch {
    // Marker comments / mixed tables: names only.
  }
  return parseCodexTomlNamesFallback(raw);
}

export function parseVibeTomlMcpServerDecls(raw: string): McpServerDecl[] {
  try {
    const parsed: unknown = parseToml(raw);
    const servers = isRecord(parsed) ? parsed.mcp_servers : undefined;
    if (Array.isArray(servers)) {
      return mergeDecls(
        servers.flatMap((item) => {
          if (!isRecord(item) || typeof item.name !== "string") return [];
          const decl = declFromEntry(item.name, item);
          return decl ? [decl] : [];
        })
      );
    }
    return mergeDecls(declsFromMap(servers));
  } catch {
    return [];
  }
}

export function parseMcpServerDecls(
  raw: string,
  format: McpConfigFormat,
  projectRootPath: string | null
): McpServerDecl[] {
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    return [];
  }
  switch (format) {
    case "codex-toml":
      return parseCodexTomlMcpServerDecls(raw);
    case "vibe-toml":
      return parseVibeTomlMcpServerDecls(raw);
    case "claude-user-json":
      return parseClaudeUserJsonMcpServerDecls(raw, projectRootPath);
    case "opencode-json":
      return parseOpencodeJsonMcpServerDecls(raw);
    case "amp-settings-json":
      return parseAmpSettingsMcpServerDecls(raw);
    case "goose-yaml":
      return parseGooseYamlMcpServerDecls(raw);
    case "hermes-yaml":
      return parseHermesYamlMcpServerDecls(raw);
    default:
      return parseJsonMcpServerDecls(raw);
  }
}
