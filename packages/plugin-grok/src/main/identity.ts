import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AccountIdentity {
  authEntryKey: string;
  email: string;
  kind: "oidc";
  providerAccountId: string;
  teamId?: string | undefined;
}

interface AuthEntry {
  auth_mode?: unknown;
  create_time?: unknown;
  email?: unknown;
  expires_at?: unknown;
  key?: unknown;
  principal_id?: unknown;
  refresh_token?: unknown;
  team_id?: unknown;
  user_id?: unknown;
}

function parseTime(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function isUsableOidcEntry(entry: AuthEntry): boolean {
  if (entry.auth_mode === "oidc") {
    return true;
  }
  return (
    (typeof entry.refresh_token === "string" &&
      entry.refresh_token.length > 0) ||
    (typeof entry.key === "string" && entry.key.length > 0)
  );
}

function entryEmail(entry: AuthEntry, entryKey: string): string {
  if (typeof entry.email === "string" && entry.email.length > 0) {
    return entry.email;
  }
  if (typeof entry.user_id === "string" && entry.user_id.length > 0) {
    return entry.user_id;
  }
  const tail = entryKey.includes("::") ? entryKey.split("::").at(-1) : entryKey;
  return tail && tail.length > 0 ? tail : entryKey;
}

function entryProviderAccountId(entry: AuthEntry, entryKey: string): string {
  if (typeof entry.user_id === "string" && entry.user_id.length > 0) {
    return entry.user_id;
  }
  if (typeof entry.principal_id === "string" && entry.principal_id.length > 0) {
    return entry.principal_id;
  }
  return entryKey;
}

/**
 * Parse Grok/xAI auth.json map of OIDC entries.
 * Prefer newest usable entry by create_time then expires_at.
 */
export function parseGrokAuthJson(raw: string): AccountIdentity | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  let best: {
    createTime: number;
    entry: AuthEntry;
    entryKey: string;
    expiresAt: number;
  } | null = null;

  for (const [entryKey, value] of Object.entries(data)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const entry = value as AuthEntry;
    if (!isUsableOidcEntry(entry)) {
      continue;
    }
    const createTime = parseTime(entry.create_time);
    const expiresAt = parseTime(entry.expires_at);
    if (
      !best ||
      createTime > best.createTime ||
      (createTime === best.createTime && expiresAt > best.expiresAt)
    ) {
      best = { createTime, entry, entryKey, expiresAt };
    }
  }

  if (!best) {
    return null;
  }

  const teamId =
    typeof best.entry.team_id === "string" && best.entry.team_id.length > 0
      ? best.entry.team_id
      : undefined;

  return {
    authEntryKey: best.entryKey,
    email: entryEmail(best.entry, best.entryKey),
    kind: "oidc",
    providerAccountId: entryProviderAccountId(best.entry, best.entryKey),
    ...(teamId ? { teamId } : {}),
  };
}

export async function readGrokIdentity(
  homeDir: string
): Promise<AccountIdentity | null> {
  try {
    const raw = await readFile(join(homeDir, "auth.json"), "utf-8");
    return parseGrokAuthJson(raw);
  } catch {
    return null;
  }
}
