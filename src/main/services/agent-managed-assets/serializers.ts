import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";

export const SERVER_KEY = "pier-memory";
export const ENGINE_PACKAGE = "@modelcontextprotocol/server-memory@0.6.3";
const BEGIN = "# pier-managed:pier-memory begin";
const END = "# pier-managed:pier-memory end";

export type MemoryConfigFormat =
  | "mcp-servers-json"
  | "opencode-json"
  | "codex-toml";

export interface PlanOk {
  fingerprint: string;
  next: string | null;
  ok: true;
}
export interface PlanFail {
  ok: false;
  reason: string;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function buildServerEntry(storePath: string): Record<string, unknown> {
  return {
    args: ["-y", ENGINE_PACKAGE],
    command: "npx",
    env: { MEMORY_FILE_PATH: storePath },
  };
}

function buildOpenCodeEntry(storePath: string): Record<string, unknown> {
  return {
    command: ["npx", "-y", ENGINE_PACKAGE],
    environment: { MEMORY_FILE_PATH: storePath },
    type: "local",
  };
}

function upsertJson(
  raw: string | null,
  storePath: string,
  topLevelKey: "mcpServers" | "mcp"
): PlanOk | PlanFail {
  let doc: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return { ok: false, reason: "config root is not an object" };
      }
      doc = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "config is not valid JSON" };
    }
  }
  const sectionRaw = doc[topLevelKey];
  const section: Record<string, unknown> =
    sectionRaw !== null &&
    typeof sectionRaw === "object" &&
    !Array.isArray(sectionRaw)
      ? { ...(sectionRaw as Record<string, unknown>) }
      : {};
  const existing = section[SERVER_KEY];
  const entry =
    topLevelKey === "mcp"
      ? buildOpenCodeEntry(storePath)
      : buildServerEntry(storePath);
  if (
    existing !== undefined &&
    sha(JSON.stringify(existing)) !== sha(JSON.stringify(entry))
  ) {
    return {
      ok: false,
      reason: `${SERVER_KEY} already defined by someone else`,
    };
  }
  section[SERVER_KEY] = entry;
  doc[topLevelKey] = section;
  return {
    fingerprint: sha(JSON.stringify(entry)),
    next: `${JSON.stringify(doc, null, 2)}\n`,
    ok: true,
  };
}

export function planJsonUpsert(
  raw: string | null,
  storePath: string
): PlanOk | PlanFail {
  return upsertJson(raw, storePath, "mcpServers");
}

export function planOpenCodeUpsert(
  raw: string | null,
  storePath: string
): PlanOk | PlanFail {
  return upsertJson(raw, storePath, "mcp");
}

function tomlBlock(storePath: string): string {
  const entry = buildServerEntry(storePath) as {
    args: string[];
    command: string;
    env: Record<string, string>;
  };
  const args = entry.args.map((arg) => JSON.stringify(arg)).join(", ");
  const envPairs = Object.entries(entry.env)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(", ");
  return [
    BEGIN,
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${args}]`,
    `env = { ${envPairs} }`,
    END,
    "",
  ].join("\n");
}

export function planTomlAppend(
  raw: string | null,
  storePath: string
): PlanOk | PlanFail {
  const source = raw ?? "";
  try {
    const parsed = parseToml(source) as {
      mcp_servers?: Record<string, unknown>;
    };
    if (parsed.mcp_servers?.[SERVER_KEY] !== undefined) {
      return {
        ok: false,
        reason: `${SERVER_KEY} already defined in codex config`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `codex config is not valid TOML: ${String(error)}`,
    };
  }
  const block = tomlBlock(storePath);
  const prefix =
    source === "" || source.endsWith("\n") ? source : `${source}\n`;
  return { fingerprint: sha(block), next: `${prefix}${block}`, ok: true };
}

export function planRemove(
  raw: string,
  format: MemoryConfigFormat
): PlanOk | PlanFail {
  if (format === "codex-toml") {
    const beginAt = raw.indexOf(BEGIN);
    const endAt = raw.indexOf(END);
    if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
      return { ok: false, reason: "managed block not found" };
    }
    const blockEnd = endAt + END.length;
    const afterNewline =
      raw.charAt(blockEnd) === "\n" ? blockEnd + 1 : blockEnd;
    const block = raw.slice(beginAt, afterNewline);
    return {
      fingerprint: sha(block),
      next: `${raw.slice(0, beginAt)}${raw.slice(afterNewline)}`,
      ok: true,
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, reason: "config root is not an object" };
    }
    const doc = { ...(parsed as Record<string, unknown>) };
    const key = format === "opencode-json" ? "mcp" : "mcpServers";
    const sectionRaw = doc[key];
    if (
      sectionRaw === null ||
      typeof sectionRaw !== "object" ||
      Array.isArray(sectionRaw)
    ) {
      return { ok: false, reason: "managed entry not found" };
    }
    const section = { ...(sectionRaw as Record<string, unknown>) };
    if (section[SERVER_KEY] === undefined) {
      return { ok: false, reason: "managed entry not found" };
    }
    const fingerprint = sha(JSON.stringify(section[SERVER_KEY]));
    delete section[SERVER_KEY];
    if (Object.keys(section).length === 0) {
      delete doc[key];
    } else {
      doc[key] = section;
    }
    if (Object.keys(doc).length === 0) {
      return { fingerprint, next: null, ok: true };
    }
    return {
      fingerprint,
      next: `${JSON.stringify(doc, null, 2)}\n`,
      ok: true,
    };
  } catch {
    return { ok: false, reason: "config is not valid JSON" };
  }
}

export function inferMemoryFormat(path: string): MemoryConfigFormat {
  if (path.endsWith(".toml")) {
    return "codex-toml";
  }
  if (path.endsWith("opencode.json")) {
    return "opencode-json";
  }
  return "mcp-servers-json";
}

export function fingerprintManagedSlice(
  raw: string | null,
  format: MemoryConfigFormat
): string {
  if (raw === null) {
    return "absent";
  }
  if (format === "codex-toml") {
    const beginAt = raw.indexOf(BEGIN);
    const endAt = raw.indexOf(END);
    if (beginAt < 0 || endAt < 0 || endAt < beginAt) {
      return "absent";
    }
    const blockEnd = endAt + END.length;
    const afterNewline =
      raw.charAt(blockEnd) === "\n" ? blockEnd + 1 : blockEnd;
    return sha(raw.slice(beginAt, afterNewline));
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return "absent";
    }
    const doc = parsed as Record<string, unknown>;
    const key = format === "opencode-json" ? "mcp" : "mcpServers";
    const sectionRaw = doc[key];
    if (
      sectionRaw === null ||
      typeof sectionRaw !== "object" ||
      Array.isArray(sectionRaw)
    ) {
      return "absent";
    }
    const entry = (sectionRaw as Record<string, unknown>)[SERVER_KEY];
    if (entry === undefined) {
      return "absent";
    }
    return sha(JSON.stringify(entry));
  } catch {
    return "absent";
  }
}
