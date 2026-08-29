import { createHash } from "node:crypto";
import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJsonc,
} from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

export const SERVER_KEY = "pier-memory";
/**
 * 引擎精确锁定 **日历版本**(该包自 0.6.2 后改用 CalVer;"0.6.3" 只是包内部
 * serverInfo 版本串,npm 上不存在)。不得回退 0.6.2:其存储路径硬编码、
 * 不读 MEMORY_FILE_PATH。升级随 Pier 发版。
 */
export const ENGINE_PACKAGE = "@modelcontextprotocol/server-memory@2026.7.4";
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

const JSONC_EDIT = {
  formattingOptions: { insertSpaces: true, tabSize: 2 },
};

function parseConfigObject(
  raw: string
): { doc: Record<string, unknown>; ok: true } | PlanFail {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (
    errors.length > 0 ||
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ok: false, reason: "config is not valid JSON" };
  }
  return { doc: parsed as Record<string, unknown>, ok: true };
}

function managedEntryOf(
  doc: Record<string, unknown>,
  topLevelKey: "mcp" | "mcpServers"
): unknown {
  const sectionRaw = doc[topLevelKey];
  if (
    sectionRaw === null ||
    typeof sectionRaw !== "object" ||
    Array.isArray(sectionRaw)
  ) {
    return;
  }
  return (sectionRaw as Record<string, unknown>)[SERVER_KEY];
}

function foreignEntryConflict(
  existing: unknown,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanFail | null {
  if (existing === undefined) {
    return null;
  }
  const existingSha = sha(JSON.stringify(existing));
  if (
    existingSha !== sha(JSON.stringify(entry)) &&
    existingSha !== ownedFingerprint
  ) {
    return {
      ok: false,
      reason: `${SERVER_KEY} already defined by someone else`,
    };
  }
  return null;
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isEmptyObjectText(raw: string): boolean {
  return raw.trim().replaceAll(/\s+/gu, "") === "{}";
}

function applyJsoncEdit(
  raw: string,
  path: Array<string | number>,
  value: unknown
): string | PlanFail {
  try {
    return applyEdits(raw, modify(raw, path, value, JSONC_EDIT));
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildServerEntry(storePath: string): Record<string, unknown> {
  return {
    args: ["-y", ENGINE_PACKAGE],
    command: "npx",
    env: { MEMORY_FILE_PATH: storePath },
  };
}

export function buildOpenCodeEntry(storePath: string): Record<string, unknown> {
  return {
    command: ["npx", "-y", ENGINE_PACKAGE],
    environment: { MEMORY_FILE_PATH: storePath },
    type: "local",
  };
}

/** v3 全局注册条目:指向启动器,无 env(项目在运行时解析)。 */
export function buildLauncherEntry(
  launcherPath: string
): Record<string, unknown> {
  return { args: [launcherPath], command: "node" };
}

export function buildOpenCodeLauncherEntry(
  launcherPath: string
): Record<string, unknown> {
  return { command: ["node", launcherPath], type: "local" };
}

function upsertJson(
  raw: string | null,
  entry: Record<string, unknown>,
  topLevelKey: "mcpServers" | "mcp",
  ownedFingerprint?: string
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
  if (existing !== undefined) {
    const existingSha = sha(JSON.stringify(existing));
    // 账本指纹匹配 = Pier 自己的旧条目(存储迁移/引擎升级),允许重写;
    // 其余一律视为第三方,拒写。
    if (
      existingSha !== sha(JSON.stringify(entry)) &&
      existingSha !== ownedFingerprint
    ) {
      return {
        ok: false,
        reason: `${SERVER_KEY} already defined by someone else`,
      };
    }
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
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanOk | PlanFail {
  return upsertJson(raw, entry, "mcpServers", ownedFingerprint);
}

export function planOpenCodeUpsert(
  raw: string | null,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanOk | PlanFail {
  if (raw === null) {
    return upsertJson(null, entry, "mcp", ownedFingerprint);
  }
  const parsed = parseConfigObject(raw);
  if (!parsed.ok) {
    return parsed;
  }
  const conflict = foreignEntryConflict(
    managedEntryOf(parsed.doc, "mcp"),
    entry,
    ownedFingerprint
  );
  if (conflict) {
    return conflict;
  }
  const mcp = parsed.doc.mcp;
  if (
    mcp !== undefined &&
    (mcp === null || typeof mcp !== "object" || Array.isArray(mcp))
  ) {
    return { ok: false, reason: "mcp is not an object" };
  }
  const next = applyJsoncEdit(raw, ["mcp", SERVER_KEY], entry);
  if (typeof next !== "string") {
    return next;
  }
  return {
    fingerprint: sha(JSON.stringify(entry)),
    next: withTrailingNewline(next),
    ok: true,
  };
}

function planOpenCodeRemove(raw: string): PlanOk | PlanFail {
  const parsed = parseConfigObject(raw);
  if (!parsed.ok) {
    return parsed;
  }
  const existing = managedEntryOf(parsed.doc, "mcp");
  if (existing === undefined) {
    return { ok: false, reason: "managed entry not found" };
  }
  const fingerprint = sha(JSON.stringify(existing));
  const sectionRaw = parsed.doc.mcp;
  const sectionSize =
    sectionRaw !== null &&
    typeof sectionRaw === "object" &&
    !Array.isArray(sectionRaw)
      ? Object.keys(sectionRaw as Record<string, unknown>).length
      : 0;
  const stripped = applyJsoncEdit(raw, ["mcp", SERVER_KEY], undefined);
  if (typeof stripped !== "string") {
    return stripped;
  }
  let next = stripped;
  if (sectionSize === 1) {
    const withoutSection = applyJsoncEdit(next, ["mcp"], undefined);
    if (typeof withoutSection !== "string") {
      return withoutSection;
    }
    next = withoutSection;
  }
  const after = parseConfigObject(next);
  if (
    after.ok &&
    Object.keys(after.doc).length === 0 &&
    isEmptyObjectText(next)
  ) {
    return { fingerprint, next: null, ok: true };
  }
  return { fingerprint, next: withTrailingNewline(next), ok: true };
}

function tomlBlock(entry: Record<string, unknown>): string {
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
          reason: `${SERVER_KEY} already defined in codex config`,
        };
      }
      source = stripped;
    }
  } catch (error) {
    return {
      ok: false,
      reason: `codex config is not valid TOML: ${String(error)}`,
    };
  }
  const block = tomlBlock(entry);
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
  if (format === "opencode-json") {
    return planOpenCodeRemove(raw);
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
    const key = "mcpServers";
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
  if (path.endsWith("opencode.json") || path.endsWith("opencode.jsonc")) {
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
  if (format === "opencode-json") {
    const parsed = parseConfigObject(raw);
    if (!parsed.ok) {
      return "absent";
    }
    const entry = managedEntryOf(parsed.doc, "mcp");
    return entry === undefined ? "absent" : sha(JSON.stringify(entry));
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
    const sectionRaw = doc.mcpServers;
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
