import { parse as parseToml } from "smol-toml";
import {
  BEGIN,
  END,
  type PlanFail,
  type PlanOk,
  SERVER_KEY,
  sha,
} from "./serializers-shared.ts";

function tomlNamedBlock(entry: Record<string, unknown>): string {
  const command = typeof entry.command === "string" ? entry.command : "";
  const args = Array.isArray(entry.args) ? (entry.args as string[]) : [];
  const env =
    entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)
      ? (entry.env as Record<string, string>)
      : null;
  const argList = args.map((arg) => JSON.stringify(arg)).join(", ");
  const lines = [
    BEGIN,
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(command)}`,
    `args = [${argList}]`,
  ];
  if (env && Object.keys(env).length > 0) {
    const envPairs = Object.entries(env)
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
      .join(", ");
    lines.push(`env = { ${envPairs} }`);
  }
  lines.push(END, "");
  return lines.join("\n");
}

function vibeArrayBlock(entry: Record<string, unknown>): string {
  const command = typeof entry.command === "string" ? entry.command : "";
  const args = Array.isArray(entry.args) ? (entry.args as string[]) : [];
  const argList = args.map((arg) => JSON.stringify(arg)).join(", ");
  return [
    BEGIN,
    "[[mcp_servers]]",
    `name = ${JSON.stringify(SERVER_KEY)}`,
    'transport = "stdio"',
    `command = ${JSON.stringify(command)}`,
    `args = [${argList}]`,
    END,
    "",
  ].join("\n");
}

/** marker 块指纹匹配 ownedFingerprint 时返回去掉该块的源文;否则 null。 */
function stripOwnedTomlBlock(
  source: string,
  ownedFingerprint: string | undefined
): string | null {
  if (!ownedFingerprint) {
    return null;
  }
  const beginAt = source.indexOf(BEGIN);
  const endAt = source.indexOf(END);
  if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
    return null;
  }
  const blockEnd = endAt + END.length;
  const afterNewline =
    source.charAt(blockEnd) === "\n" ? blockEnd + 1 : blockEnd;
  if (sha(source.slice(beginAt, afterNewline)) !== ownedFingerprint) {
    return null;
  }
  return `${source.slice(0, beginAt)}${source.slice(afterNewline)}`;
}

function appendTomlBlock(source: string, block: string): PlanOk {
  const prefix =
    source === "" || source.endsWith("\n") ? source : `${source}\n`;
  return { fingerprint: sha(block), next: `${prefix}${block}`, ok: true };
}

export function planTomlAppend(
  raw: string | null,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanOk | PlanFail {
  let source = raw ?? "";
  try {
    const parsed = parseToml(source) as {
      mcp_servers?: Record<string, unknown>;
    };
    if (parsed.mcp_servers?.[SERVER_KEY] !== undefined) {
      const stripped = stripOwnedTomlBlock(source, ownedFingerprint);
      if (stripped === null) {
        return {
          ok: false,
          reason: `${SERVER_KEY} already defined in TOML MCP config`,
        };
      }
      source = stripped;
    }
  } catch (error) {
    return {
      ok: false,
      reason: `TOML MCP config is not valid: ${String(error)}`,
    };
  }
  return appendTomlBlock(source, tomlNamedBlock(entry));
}

const EMPTY_MCP_SERVERS_ASSIGNMENT =
  /^[ \t]*mcp_servers[ \t]*=[ \t]*\[[ \t]*\][ \t]*(?:\r?\n|$)/m;
const MCP_SERVERS_ASSIGNMENT = /^[ \t]*mcp_servers[ \t]*=/m;

function vibeServers(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }
  return (parsed as { mcp_servers?: unknown }).mcp_servers;
}

function vibeArrayHasServer(servers: unknown): boolean {
  if (!Array.isArray(servers)) {
    return false;
  }
  return servers.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { name?: unknown }).name === SERVER_KEY
  );
}

function prepareVibeSource(
  source: string,
  ownedFingerprint?: string
): { source: string; ok: true } | PlanFail {
  let next = source;
  let parsed: unknown;
  try {
    parsed = parseToml(next);
  } catch (error) {
    if (EMPTY_MCP_SERVERS_ASSIGNMENT.test(next)) {
      next = next.replace(EMPTY_MCP_SERVERS_ASSIGNMENT, "");
      try {
        parsed = parseToml(next);
      } catch (retryError) {
        return {
          ok: false,
          reason: `vibe config is not valid TOML: ${String(retryError)}`,
        };
      }
    } else {
      return {
        ok: false,
        reason: `vibe config is not valid TOML: ${String(error)}`,
      };
    }
  }
  const servers = vibeServers(parsed);
  if (
    servers !== undefined &&
    typeof servers === "object" &&
    !Array.isArray(servers)
  ) {
    return {
      ok: false,
      reason: "cannot mix [mcp_servers.*] tables with [[mcp_servers]]",
    };
  }
  if (vibeArrayHasServer(servers)) {
    const stripped = stripOwnedTomlBlock(next, ownedFingerprint);
    if (stripped === null) {
      return {
        ok: false,
        reason: `${SERVER_KEY} already defined in vibe config`,
      };
    }
    next = stripped;
  }
  if (MCP_SERVERS_ASSIGNMENT.test(next)) {
    if (!EMPTY_MCP_SERVERS_ASSIGNMENT.test(next)) {
      return {
        ok: false,
        reason: "cannot mix mcp_servers = [...] with [[mcp_servers]]",
      };
    }
    next = next.replace(EMPTY_MCP_SERVERS_ASSIGNMENT, "");
  }
  return { ok: true, source: next };
}

export function planVibeAppend(
  raw: string | null,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanOk | PlanFail {
  const prepared = prepareVibeSource(raw ?? "", ownedFingerprint);
  if (!prepared.ok) {
    return prepared;
  }
  return appendTomlBlock(prepared.source, vibeArrayBlock(entry));
}

export function planTomlMarkerRemove(raw: string): PlanOk | PlanFail {
  const beginAt = raw.indexOf(BEGIN);
  const endAt = raw.indexOf(END);
  if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
    return { ok: false, reason: "managed block not found" };
  }
  const blockEnd = endAt + END.length;
  const afterNewline = raw.charAt(blockEnd) === "\n" ? blockEnd + 1 : blockEnd;
  const block = raw.slice(beginAt, afterNewline);
  return {
    fingerprint: sha(block),
    next: `${raw.slice(0, beginAt)}${raw.slice(afterNewline)}`,
    ok: true,
  };
}

export function fingerprintTomlMarker(raw: string): string {
  const beginAt = raw.indexOf(BEGIN);
  const endAt = raw.indexOf(END);
  if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
    return "absent";
  }
  const blockEnd = endAt + END.length;
  const afterNewline = raw.charAt(blockEnd) === "\n" ? blockEnd + 1 : blockEnd;
  return sha(raw.slice(beginAt, afterNewline));
}
