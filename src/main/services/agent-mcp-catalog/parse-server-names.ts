/**
 * Name-only wrappers over {@link parseMcpServerDecls}. Catalog snapshots must
 * never include command/args/env/url/headers payloads.
 */

import {
  type McpConfigFormat,
  type McpServerDecl,
  parseAmpSettingsMcpServerDecls,
  parseClaudeUserJsonMcpServerDecls,
  parseCodexTomlMcpServerDecls,
  parseGooseYamlMcpServerDecls,
  parseHermesYamlMcpServerDecls,
  parseJsonMcpServerDecls,
  parseMcpServerDecls,
  parseOpencodeJsonMcpServerDecls,
  parseVibeTomlMcpServerDecls,
} from "./parse-server-decls.ts";

export type { McpConfigFormat, McpServerDecl } from "./parse-server-decls.ts";
export { MCP_PARSE_MAX_BYTES } from "./parse-server-decls.ts";

function namesOf(decls: readonly McpServerDecl[]): string[] {
  return decls.map((decl) => decl.name);
}

export function parseCodexTomlMcpServerNames(raw: string): string[] {
  return namesOf(parseCodexTomlMcpServerDecls(raw));
}

export function parseJsonMcpServerNames(raw: string): string[] {
  return namesOf(parseJsonMcpServerDecls(raw));
}

export function parseOpencodeJsonMcpServerNames(raw: string): string[] {
  return namesOf(parseOpencodeJsonMcpServerDecls(raw));
}

export function parseClaudeUserJsonMcpServerNames(
  raw: string,
  projectRootPath: string | null
): string[] {
  return namesOf(parseClaudeUserJsonMcpServerDecls(raw, projectRootPath));
}

export function parseAmpSettingsMcpServerNames(raw: string): string[] {
  return namesOf(parseAmpSettingsMcpServerDecls(raw));
}

export function parseGooseYamlMcpServerNames(raw: string): string[] {
  return namesOf(parseGooseYamlMcpServerDecls(raw));
}

export function parseHermesYamlMcpServerNames(raw: string): string[] {
  return namesOf(parseHermesYamlMcpServerDecls(raw));
}

export function parseVibeTomlMcpServerNames(raw: string): string[] {
  return namesOf(parseVibeTomlMcpServerDecls(raw));
}

export function parseMcpServerNames(
  raw: string,
  format: McpConfigFormat,
  projectRootPath: string | null
): string[] {
  return namesOf(parseMcpServerDecls(raw, format, projectRootPath));
}
