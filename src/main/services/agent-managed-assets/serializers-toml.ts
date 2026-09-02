import { parse as parseToml } from "smol-toml";
import {
  BEGIN,
  END,
  type PlanFail,
  type PlanOk,
  SERVER_KEY,
  sha,
} from "./serializers-shared.ts";

const TOML_NAMED_KEYS = new Set(["args", "command", "env"]);
const VIBE_ITEM_KEYS = new Set(["args", "command", "name", "transport"]);

function sameStringList(left: unknown, right: unknown): boolean {
  if (!(Array.isArray(left) && Array.isArray(right))) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function envRecord(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== "string") {
      return null;
    }
    record[key] = item;
  }
  return record;
}

function sameEnv(left: unknown, right: unknown): boolean {
  const a = envRecord(left);
  const b = envRecord(right);
  if (a === null || b === null) {
    return false;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function isPlainTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  table: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  return Object.keys(table).every((key) => allowed.has(key));
}

/** Named `[mcp_servers.pier-memory]` matches the stdio entry we would write. */
function tomlServerMatchesEntry(
  existing: unknown,
  entry: Record<string, unknown>
): boolean {
  if (!(isPlainTable(existing) && hasOnlyKeys(existing, TOML_NAMED_KEYS))) {
    return false;
  }
  return (
    existing.command === entry.command &&
    sameStringList(existing.args, entry.args) &&
    sameEnv(existing.env, entry.env)
  );
}

/** `[[mcp_servers]]` item with name=pier-memory matches the vibe block we write. */
function vibeItemMatchesEntry(
  existing: unknown,
  entry: Record<string, unknown>
): boolean {
  if (!(isPlainTable(existing) && hasOnlyKeys(existing, VIBE_ITEM_KEYS))) {
    return false;
  }
  if (existing.name !== SERVER_KEY) {
    return false;
  }
  if (existing.transport !== undefined && existing.transport !== "stdio") {
    return false;
  }
  return (
    existing.command === entry.command &&
    sameStringList(existing.args, entry.args)
  );
}

const NAMED_MEMORY_TABLE_HEADER =
  /^\[mcp_servers\.(?:pier-memory|"pier-memory")\][ \t]*(?:\r?\n|$)/mu;
const VIBE_ARRAY_HEADER = /^\[\[mcp_servers\]\][ \t]*(?:\r?\n|$)/gmu;
const VIBE_NAME_LINE =
  /^[ \t]*name[ \t]*=[ \t]*(?:"pier-memory"|'pier-memory')[ \t]*(?:\r?\n|$)/m;

function nextTableIndex(source: string, afterHeader: number): number {
  const rest = source.slice(afterHeader);
  const nextTable = rest.search(/^\[[^\]]+\]/mu);
  return nextTable < 0 ? source.length : afterHeader + nextTable;
}

/** Drop an unmarked `[mcp_servers.pier-memory]` table; preserve the rest. */
function stripTomlNamedServerTable(source: string): string | null {
  const match = NAMED_MEMORY_TABLE_HEADER.exec(source);
  if (match === null || match.index === undefined) {
    return null;
  }
  const start = match.index;
  const afterHeader = start + match[0].length;
  const end = nextTableIndex(source, afterHeader);
  return `${source.slice(0, start)}${source.slice(end)}`;
}

function vibeArrayTableRanges(
  source: string
): Array<{ end: number; start: number }> {
  const ranges: Array<{ end: number; start: number }> = [];
  for (const match of source.matchAll(VIBE_ARRAY_HEADER)) {
    if (match.index === undefined) {
      continue;
    }
    const start = match.index;
    const afterHeader = start + match[0].length;
    ranges.push({ end: nextTableIndex(source, afterHeader), start });
  }
  return ranges;
}

function stripVibeNamedServerArrayTable(source: string): string | null {
  const pier = vibeArrayTableRanges(source).filter((range) =>
    VIBE_NAME_LINE.test(source.slice(range.start, range.end))
  );
  if (pier.length !== 1) {
    return null;
  }
  const range = pier[0];
  if (range === undefined) {
    return null;
  }
  return `${source.slice(0, range.start)}${source.slice(range.end)}`;
}

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

function markedBlockBounds(
  source: string
): { afterNewline: number; beginAt: number } | null {
  const beginAt = source.indexOf(BEGIN);
  const endAt = source.indexOf(END);
  if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
    return null;
  }
  const blockEnd = endAt + END.length;
  const afterNewline =
    source.charAt(blockEnd) === "\n" ? blockEnd + 1 : blockEnd;
  return { afterNewline, beginAt };
}

/** marker 块指纹匹配 ownedFingerprint 时返回去掉该块的源文;否则 null。 */
function stripOwnedTomlBlock(
  source: string,
  ownedFingerprint: string | undefined
): string | null {
  if (!ownedFingerprint) {
    return null;
  }
  const bounds = markedBlockBounds(source);
  if (bounds === null) {
    return null;
  }
  if (
    sha(source.slice(bounds.beginAt, bounds.afterNewline)) !== ownedFingerprint
  ) {
    return null;
  }
  return `${source.slice(0, bounds.beginAt)}${source.slice(bounds.afterNewline)}`;
}

/** Equivalent body: drop a drifted marker wrapper without fingerprint. */
function stripMarkedTomlBlock(source: string): string | null {
  const bounds = markedBlockBounds(source);
  if (bounds === null) {
    return null;
  }
  return `${source.slice(0, bounds.beginAt)}${source.slice(bounds.afterNewline)}`;
}

function stripEquivalentToml(
  source: string,
  stripUnmarked: (raw: string) => string | null
): string | null {
  const strippedMarked = stripMarkedTomlBlock(source);
  if (strippedMarked !== null) {
    return strippedMarked;
  }
  return stripUnmarked(source);
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
      const existing = parsed.mcp_servers[SERVER_KEY];
      const strippedOwned = stripOwnedTomlBlock(source, ownedFingerprint);
      if (strippedOwned !== null) {
        source = strippedOwned;
      } else if (tomlServerMatchesEntry(existing, entry)) {
        const stripped = stripEquivalentToml(source, stripTomlNamedServerTable);
        if (stripped === null) {
          return {
            ok: false,
            reason: `${SERVER_KEY} already defined in TOML MCP config`,
          };
        }
        source = stripped;
      } else {
        return {
          ok: false,
          reason: `${SERVER_KEY} already defined in TOML MCP config`,
        };
      }
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

function vibePierMemoryItems(servers: unknown): unknown[] {
  if (!Array.isArray(servers)) {
    return [];
  }
  return servers.filter(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { name?: unknown }).name === SERVER_KEY
  );
}

function prepareVibeSource(
  source: string,
  entry: Record<string, unknown>,
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
  const pierItems = vibePierMemoryItems(servers);
  if (pierItems.length > 0) {
    const strippedOwned = stripOwnedTomlBlock(next, ownedFingerprint);
    if (strippedOwned !== null) {
      next = strippedOwned;
    } else if (
      pierItems.length === 1 &&
      vibeItemMatchesEntry(pierItems[0], entry)
    ) {
      const stripped = stripEquivalentToml(
        next,
        stripVibeNamedServerArrayTable
      );
      if (stripped === null) {
        return {
          ok: false,
          reason: `${SERVER_KEY} already defined in vibe config`,
        };
      }
      next = stripped;
    } else {
      return {
        ok: false,
        reason: `${SERVER_KEY} already defined in vibe config`,
      };
    }
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
  const prepared = prepareVibeSource(raw ?? "", entry, ownedFingerprint);
  if (!prepared.ok) {
    return prepared;
  }
  return appendTomlBlock(prepared.source, vibeArrayBlock(entry));
}

export function planTomlMarkerRemove(raw: string): PlanOk | PlanFail {
  const bounds = markedBlockBounds(raw);
  if (bounds === null) {
    return { ok: false, reason: "managed block not found" };
  }
  const block = raw.slice(bounds.beginAt, bounds.afterNewline);
  return {
    fingerprint: sha(block),
    next: `${raw.slice(0, bounds.beginAt)}${raw.slice(bounds.afterNewline)}`,
    ok: true,
  };
}

export function fingerprintTomlMarker(raw: string): string {
  const bounds = markedBlockBounds(raw);
  if (bounds === null) {
    return "absent";
  }
  return sha(raw.slice(bounds.beginAt, bounds.afterNewline));
}
