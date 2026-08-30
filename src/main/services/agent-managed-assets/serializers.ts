import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJsonc,
} from "jsonc-parser";
import {
  ENGINE_PACKAGE,
  foreignEntryConflict,
  type MemoryConfigFormat,
  type PlanFail,
  type PlanOk,
  SERVER_KEY,
  sha,
  withTrailingNewline,
} from "./serializers-shared.ts";
import {
  fingerprintTomlMarker,
  planTomlAppend,
  planTomlMarkerRemove,
  planVibeAppend,
} from "./serializers-toml.ts";
import {
  fingerprintYamlSection,
  planYamlSectionRemove,
  planYamlSectionUpsert,
} from "./serializers-yaml.ts";

export {
  ENGINE_PACKAGE,
  type MemoryConfigFormat,
  type PlanFail,
  type PlanOk,
  SERVER_KEY,
} from "./serializers-shared.ts";
export { planTomlAppend, planVibeAppend } from "./serializers-toml.ts";
export { buildGooseLauncherEntry } from "./serializers-yaml.ts";

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

export function buildCopilotLauncherEntry(
  launcherPath: string
): Record<string, unknown> {
  return {
    args: [launcherPath],
    command: "node",
    tools: ["*"],
    type: "local",
  };
}

export function buildRovoLauncherEntry(
  launcherPath: string
): Record<string, unknown> {
  return {
    args: [launcherPath],
    command: "node",
    transport: "stdio",
  };
}

function upsertJson(
  raw: string | null,
  entry: Record<string, unknown>,
  topLevelKey: string,
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

function jsonSectionKey(format: MemoryConfigFormat): string {
  return format === "amp-settings-json" ? "amp.mcpServers" : "mcpServers";
}

function planJsonKeyedRemove(raw: string, key: string): PlanOk | PlanFail {
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

export function planRemove(
  raw: string,
  format: MemoryConfigFormat
): PlanOk | PlanFail {
  if (format === "codex-toml" || format === "vibe-toml") {
    return planTomlMarkerRemove(raw);
  }
  if (format === "opencode-json") {
    return planOpenCodeRemove(raw);
  }
  if (format === "goose-yaml") {
    return planYamlSectionRemove(raw, "extensions");
  }
  if (format === "hermes-yaml") {
    return planYamlSectionRemove(raw, "mcp_servers");
  }
  return planJsonKeyedRemove(raw, jsonSectionKey(format));
}

export function planMemoryUpsert(
  format: MemoryConfigFormat,
  raw: string | null,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanOk | PlanFail {
  if (format === "codex-toml") {
    return planTomlAppend(raw, entry, ownedFingerprint);
  }
  if (format === "vibe-toml") {
    return planVibeAppend(raw, entry, ownedFingerprint);
  }
  if (format === "opencode-json") {
    return planOpenCodeUpsert(raw, entry, ownedFingerprint);
  }
  if (format === "goose-yaml") {
    return planYamlSectionUpsert(raw, "extensions", entry, ownedFingerprint);
  }
  if (format === "hermes-yaml") {
    return planYamlSectionUpsert(raw, "mcp_servers", entry, ownedFingerprint);
  }
  if (format === "amp-settings-json") {
    return upsertJson(raw, entry, "amp.mcpServers", ownedFingerprint);
  }
  return planJsonUpsert(raw, entry, ownedFingerprint);
}

const OPENCODE_JSON_BASENAMES = new Set([
  "crush.json",
  "crush.jsonc",
  "kilo.json",
  "kilo.jsonc",
  "opencode.json",
  "opencode.jsonc",
]);

export function inferMemoryFormat(path: string): MemoryConfigFormat {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.endsWith("/.vibe/config.toml") ||
    normalized.endsWith("/vibe/config.toml")
  ) {
    return "vibe-toml";
  }
  if (normalized.endsWith(".toml")) {
    return "codex-toml";
  }
  if (normalized.endsWith("/goose/config.yaml")) {
    return "goose-yaml";
  }
  if (normalized.endsWith("/.hermes/config.yaml")) {
    return "hermes-yaml";
  }
  if (normalized.endsWith("/amp/settings.json")) {
    return "amp-settings-json";
  }
  const base = normalized.split("/").pop() ?? "";
  if (OPENCODE_JSON_BASENAMES.has(base)) {
    return "opencode-json";
  }
  return "mcp-servers-json";
}

function fingerprintJsonSection(raw: string, key: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return "absent";
    }
    const sectionRaw = (parsed as Record<string, unknown>)[key];
    if (
      sectionRaw === null ||
      typeof sectionRaw !== "object" ||
      Array.isArray(sectionRaw)
    ) {
      return "absent";
    }
    const entry = (sectionRaw as Record<string, unknown>)[SERVER_KEY];
    return entry === undefined ? "absent" : sha(JSON.stringify(entry));
  } catch {
    return "absent";
  }
}

export function fingerprintManagedSlice(
  raw: string | null,
  format: MemoryConfigFormat
): string {
  if (raw === null) {
    return "absent";
  }
  if (format === "codex-toml" || format === "vibe-toml") {
    return fingerprintTomlMarker(raw);
  }
  if (format === "goose-yaml") {
    return fingerprintYamlSection(raw, "extensions");
  }
  if (format === "hermes-yaml") {
    return fingerprintYamlSection(raw, "mcp_servers");
  }
  if (format === "opencode-json") {
    const parsed = parseConfigObject(raw);
    if (!parsed.ok) {
      return "absent";
    }
    const entry = managedEntryOf(parsed.doc, "mcp");
    return entry === undefined ? "absent" : sha(JSON.stringify(entry));
  }
  return fingerprintJsonSection(raw, jsonSectionKey(format));
}
