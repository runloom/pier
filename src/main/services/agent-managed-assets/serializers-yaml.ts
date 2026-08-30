import { Document, isMap, parseDocument, YAMLMap } from "yaml";
import {
  foreignEntryConflict,
  type PlanFail,
  type PlanOk,
  SERVER_KEY,
  sha,
  withTrailingNewline,
} from "./serializers-shared.ts";

function yamlJson(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

function loadYamlDoc(raw: string | null): Document | PlanFail {
  if (raw === null || raw.trim() === "") {
    return new Document({});
  }
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      return { ok: false, reason: "config is not valid YAML" };
    }
    return doc;
  } catch (error) {
    return {
      ok: false,
      reason: `config is not valid YAML: ${String(error)}`,
    };
  }
}

function isFail<T extends object>(value: T | PlanFail): value is PlanFail {
  return "ok" in value && (value as PlanFail).ok === false;
}

function sectionMap(doc: Document, sectionKey: string): YAMLMap | PlanFail {
  const section = doc.get(sectionKey);
  if (section == null) {
    const map = new YAMLMap(doc.schema);
    doc.set(sectionKey, map);
    return map;
  }
  if (!isMap(section)) {
    return { ok: false, reason: `${sectionKey} is not a mapping` };
  }
  return section;
}

export function planYamlSectionUpsert(
  raw: string | null,
  sectionKey: string,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanOk | PlanFail {
  const doc = loadYamlDoc(raw);
  if (isFail(doc)) {
    return doc;
  }
  const section = sectionMap(doc, sectionKey);
  if (isFail(section)) {
    return section;
  }
  const existing = yamlJson(section.get(SERVER_KEY));
  const conflict = foreignEntryConflict(existing, entry, ownedFingerprint);
  if (conflict) {
    return conflict;
  }
  section.set(SERVER_KEY, doc.createNode(entry));
  return {
    fingerprint: sha(JSON.stringify(yamlJson(section.get(SERVER_KEY)))),
    next: withTrailingNewline(String(doc)),
    ok: true,
  };
}

export function planYamlSectionRemove(
  raw: string,
  sectionKey: string
): PlanOk | PlanFail {
  const doc = loadYamlDoc(raw);
  if (isFail(doc)) {
    return doc;
  }
  const section = doc.get(sectionKey);
  if (!isMap(section)) {
    return { ok: false, reason: "managed entry not found" };
  }
  const existing = section.get(SERVER_KEY);
  if (existing == null) {
    return { ok: false, reason: "managed entry not found" };
  }
  const fingerprint = sha(JSON.stringify(yamlJson(existing)));
  section.delete(SERVER_KEY);
  if (section.items.length === 0) {
    doc.delete(sectionKey);
  }
  const js: unknown = doc.toJS();
  if (
    js === null ||
    js === undefined ||
    (typeof js === "object" &&
      !Array.isArray(js) &&
      Object.keys(js as Record<string, unknown>).length === 0)
  ) {
    return { fingerprint, next: null, ok: true };
  }
  return {
    fingerprint,
    next: withTrailingNewline(String(doc)),
    ok: true,
  };
}

export function fingerprintYamlSection(
  raw: string,
  sectionKey: string
): string {
  const doc = loadYamlDoc(raw);
  if (isFail(doc)) {
    return "absent";
  }
  const section = doc.get(sectionKey);
  if (!isMap(section)) {
    return "absent";
  }
  const existing = section.get(SERVER_KEY);
  if (existing == null) {
    return "absent";
  }
  return sha(JSON.stringify(yamlJson(existing)));
}

export function buildGooseLauncherEntry(
  launcherPath: string
): Record<string, unknown> {
  return {
    args: [launcherPath],
    cmd: "node",
    enabled: true,
    name: SERVER_KEY,
    timeout: 300,
    type: "stdio",
  };
}
