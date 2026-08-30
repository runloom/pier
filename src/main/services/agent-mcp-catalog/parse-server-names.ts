/**
 * Extract MCP server *names* only from known config shapes. Never returns
 * command/args/env/url payloads (secrets stay out of the catalog snapshot).
 */

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

const MAX_BYTES = 512 * 1024;

/** `[mcp_servers.name]` or `[mcp_servers."name"]` — Codex user config. */
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

function uniqueSorted(names: Iterable<string>): string[] {
  return [...new Set(names)]
    .filter((n) => n.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function keysOfMcpServers(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const nested = record.mcpServers;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return [];
  return Object.keys(nested as Record<string, unknown>).filter(
    (key) => typeof key === "string" && key.trim().length > 0
  );
}

/** OpenCode native `mcp` map (+ optional `mcpServers` compatibility). */
function keysOfOpencodeMcp(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const names: string[] = [];
  const native = record.mcp;
  if (native && typeof native === "object" && !Array.isArray(native)) {
    names.push(...Object.keys(native as Record<string, unknown>));
  }
  names.push(...keysOfMcpServers(record));
  return names.filter((key) => key.trim().length > 0);
}

function unescapeTomlString(raw: string): string {
  return raw.replace(/\\(["\\])/g, "$1");
}

export function parseCodexTomlMcpServerNames(raw: string): string[] {
  const names: string[] = [];
  CODEX_MCP_SERVER_HEADER.lastIndex = 0;
  for (const match of raw.matchAll(CODEX_MCP_SERVER_HEADER)) {
    const quoted = match[1];
    const bare = match[2];
    if (typeof quoted === "string") {
      names.push(unescapeTomlString(quoted));
    } else if (typeof bare === "string") {
      names.push(bare);
    }
  }
  return uniqueSorted(names);
}

export function parseJsonMcpServerNames(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return uniqueSorted(keysOfMcpServers(parsed));
}

export function parseOpencodeJsonMcpServerNames(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return uniqueSorted(keysOfOpencodeMcp(parsed));
}

/**
 * Claude Code user file may nest project MCP under `projects[path].mcpServers`
 * in addition to top-level `mcpServers`.
 */
export function parseClaudeUserJsonMcpServerNames(
  raw: string,
  projectRootPath: string | null
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const root = parsed as Record<string, unknown>;
  const names = keysOfMcpServers(root);
  if (!projectRootPath) {
    return uniqueSorted(names);
  }
  const projects = root.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    return uniqueSorted(names);
  }
  const projectMap = projects as Record<string, unknown>;
  for (const [key, value] of Object.entries(projectMap)) {
    if (key !== projectRootPath) continue;
    names.push(...keysOfMcpServers(value));
  }
  return uniqueSorted(names);
}

function keysOfRecord(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return [];
  return Object.keys(nested as Record<string, unknown>).filter(
    (name) => typeof name === "string" && name.trim().length > 0
  );
}

export function parseAmpSettingsMcpServerNames(raw: string): string[] {
  try {
    return uniqueSorted(
      keysOfRecord(JSON.parse(raw) as unknown, "amp.mcpServers")
    );
  } catch {
    return [];
  }
}

export function parseGooseYamlMcpServerNames(raw: string): string[] {
  try {
    return uniqueSorted(keysOfRecord(parseYaml(raw), "extensions"));
  } catch {
    return [];
  }
}

export function parseHermesYamlMcpServerNames(raw: string): string[] {
  try {
    return uniqueSorted(keysOfRecord(parseYaml(raw), "mcp_servers"));
  } catch {
    return [];
  }
}

export function parseVibeTomlMcpServerNames(raw: string): string[] {
  try {
    const parsed: unknown = parseToml(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const servers = (parsed as { mcp_servers?: unknown }).mcp_servers;
    if (Array.isArray(servers)) {
      return uniqueSorted(
        servers.flatMap((item) => {
          if (
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as { name?: unknown }).name === "string"
          ) {
            return [(item as { name: string }).name];
          }
          return [];
        })
      );
    }
    return uniqueSorted(keysOfRecord(parsed, "mcp_servers"));
  } catch {
    return [];
  }
}

export function parseMcpServerNames(
  raw: string,
  format: McpConfigFormat,
  projectRootPath: string | null
): string[] {
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    return [];
  }
  switch (format) {
    case "codex-toml":
      return parseCodexTomlMcpServerNames(raw);
    case "vibe-toml":
      return parseVibeTomlMcpServerNames(raw);
    case "claude-user-json":
      return parseClaudeUserJsonMcpServerNames(raw, projectRootPath);
    case "opencode-json":
      return parseOpencodeJsonMcpServerNames(raw);
    case "amp-settings-json":
      return parseAmpSettingsMcpServerNames(raw);
    case "goose-yaml":
      return parseGooseYamlMcpServerNames(raw);
    case "hermes-yaml":
      return parseHermesYamlMcpServerNames(raw);
    default:
      return parseJsonMcpServerNames(raw);
  }
}

export const MCP_PARSE_MAX_BYTES = MAX_BYTES;
