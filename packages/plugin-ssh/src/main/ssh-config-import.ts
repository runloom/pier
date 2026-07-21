import { randomUUID } from "node:crypto";
import { SSH_MAX_PORT, type SshHost } from "../shared/hosts.ts";

/**
 * Minimal OpenSSH client config parser for import candidates. Reads `Host`
 * blocks with HostName / User / Port / IdentityFile options. Wildcard and
 * negated patterns are skipped — only concrete aliases are importable.
 * `Include` directives are not followed (v1).
 */

interface SshConfigBlock {
  alias: string;
  hostName?: string;
  identityFile?: string;
  port?: number;
  user?: string;
}

const WILDCARD_PATTERN = /[*?]/;

function matchesHostPattern(alias: string, pattern: string): boolean {
  const source = pattern
    .replace(/[\\^$+.()|[\]{}]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${source}$`, "i").test(alias);
}

function parseOption(line: string): { key: string; value: string } | null {
  const match = /^\s*(\w+)\s*[=\s]\s*(.+?)\s*$/.exec(line);
  if (!(match?.[1] && match[2])) {
    return null;
  }
  return { key: match[1].toLowerCase(), value: match[2] };
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseSshConfigHosts(content: string): SshConfigBlock[] {
  const blocks: SshConfigBlock[] = [];
  let currentAliases: string[] = [];
  let currentBlocks: SshConfigBlock[] = [];

  const flush = (): void => {
    blocks.push(...currentBlocks);
    currentAliases = [];
    currentBlocks = [];
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    const option = parseOption(line);
    if (!option) {
      continue;
    }
    if (option.key === "host") {
      flush();
      const patterns = option.value
        .split(/\s+/)
        .map(stripQuotes)
        .filter(Boolean);
      const excludedPatterns = patterns
        .filter((pattern) => pattern.startsWith("!"))
        .map((pattern) => pattern.slice(1))
        .filter(Boolean);
      currentAliases = patterns.filter(
        (alias) =>
          !(
            alias.startsWith("!") ||
            WILDCARD_PATTERN.test(alias) ||
            excludedPatterns.some((pattern) =>
              matchesHostPattern(alias, pattern)
            )
          )
      );
      currentBlocks = currentAliases.map((alias) => ({ alias }));
      continue;
    }
    if (currentBlocks.length === 0) {
      continue;
    }
    const value = stripQuotes(option.value);
    for (const block of currentBlocks) {
      if (option.key === "hostname") {
        block.hostName = value;
      } else if (option.key === "user") {
        block.user = value;
      } else if (option.key === "identityfile") {
        block.identityFile = value;
      } else if (option.key === "port") {
        const port = Number.parseInt(value, 10);
        if (Number.isInteger(port) && port >= 1 && port <= SSH_MAX_PORT) {
          block.port = port;
        }
      }
    }
  }
  flush();
  return blocks;
}

/**
 * Convert parsed config blocks into import candidates, excluding aliases that
 * already exist in the store (matched on the connect target `host`).
 */
export function toImportCandidates(
  blocks: readonly SshConfigBlock[],
  existing: readonly SshHost[]
): SshHost[] {
  const existingAliases = new Set(existing.map((host) => host.host));
  const candidates: SshHost[] = [];
  for (const block of blocks) {
    if (existingAliases.has(block.alias)) {
      continue;
    }
    // Keep only the alias. OpenSSH merges every matching Host block using
    // first-value-wins semantics (including wildcard/Include rules); copying
    // selected fields here would override that resolution and can connect as
    // the wrong user or with the wrong identity.
    const candidate: SshHost = {
      host: block.alias,
      id: randomUUID(),
      name: block.alias,
    };
    existingAliases.add(block.alias);
    candidates.push(candidate);
  }
  return candidates;
}
