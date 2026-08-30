import { createHash } from "node:crypto";

export const SERVER_KEY = "pier-memory";
/**
 * 引擎精确锁定 **日历版本**(该包自 0.6.2 后改用 CalVer;"0.6.3" 只是包内部
 * serverInfo 版本串,npm 上不存在)。不得回退 0.6.2:其存储路径硬编码、
 * 不读 MEMORY_FILE_PATH。升级随 Pier 发版。
 */
export const ENGINE_PACKAGE = "@modelcontextprotocol/server-memory@2026.7.4";
export const BEGIN = "# pier-managed:pier-memory begin";
export const END = "# pier-managed:pier-memory end";

export type MemoryConfigFormat =
  | "mcp-servers-json"
  | "opencode-json"
  | "codex-toml"
  | "amp-settings-json"
  | "goose-yaml"
  | "hermes-yaml"
  | "vibe-toml";

export interface PlanOk {
  fingerprint: string;
  next: string | null;
  ok: true;
}
export interface PlanFail {
  ok: false;
  reason: string;
}

export const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function foreignEntryConflict(
  existing: unknown,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
): PlanFail | null {
  if (existing === undefined || existing === null) {
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
