/**
 * Claude account identity parsing.
 *
 * Identity lives in two places Claude Code maintains:
 * - `~/.claude.json` → `oauthAccount` block: `{ emailAddress, accountUuid,
 *   organizationName, organizationUuid, displayName, ... }`.
 * - the credential envelope (`{ claudeAiOauth: { subscriptionType, ... } }`).
 *
 * The stable account key is `accountUuid` — it survives OAuth token rotation,
 * so it maps onto Codex/Grok's `providerAccountId` for drift/dedupe matching.
 */

export interface AccountIdentity {
  email: string;
  organizationName?: string | undefined;
  organizationUuid?: string | undefined;
  /** Stable id = accountUuid. */
  providerAccountId: string;
  /** claude.ai subscription tier (pro / max / team / …) when known. */
  subscriptionType?: string | undefined;
}

/** The managed, restorable representation of one Claude account. */
export interface ManagedClaudeCredential {
  /** Raw active-store envelope bytes (`{ claudeAiOauth: {...}, mcpOAuth? }`). */
  credential: string;
  /** oauthAccount block to restore into `~/.claude.json` (identity cache). */
  oauthAccount: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Extract the `subscriptionType` from a credential envelope string. */
export function subscriptionTypeFromCredential(
  credential: string
): string | undefined {
  try {
    const root = asRecord(JSON.parse(credential));
    const oauth = asRecord(root?.claudeAiOauth) ?? root;
    return oauth ? stringField(oauth, "subscriptionType") : undefined;
  } catch {
    return;
  }
}

/** Parse identity from an `oauthAccount` block (+ optional credential). */
export function parseIdentityFromOauthAccount(
  oauthAccount: Record<string, unknown> | null,
  credential?: string
): AccountIdentity | null {
  if (!oauthAccount) {
    return null;
  }
  const email = stringField(oauthAccount, "emailAddress");
  const providerAccountId = stringField(oauthAccount, "accountUuid");
  if (!(email && providerAccountId)) {
    return null;
  }
  const subscriptionType = credential
    ? subscriptionTypeFromCredential(credential)
    : undefined;
  return {
    email,
    providerAccountId,
    ...(stringField(oauthAccount, "organizationName")
      ? { organizationName: stringField(oauthAccount, "organizationName") }
      : {}),
    ...(stringField(oauthAccount, "organizationUuid")
      ? { organizationUuid: stringField(oauthAccount, "organizationUuid") }
      : {}),
    ...(subscriptionType ? { subscriptionType } : {}),
  };
}

/** Read the `oauthAccount` block from a `~/.claude.json` content string. */
export function readOauthAccountFromClaudeJson(
  raw: string
): Record<string, unknown> | null {
  try {
    const root = asRecord(JSON.parse(raw));
    return asRecord(root?.oauthAccount);
  } catch {
    return null;
  }
}

/** Parse identity from a stored managed credential record. */
export function parseManagedIdentity(
  managed: ManagedClaudeCredential
): AccountIdentity | null {
  return parseIdentityFromOauthAccount(
    managed.oauthAccount,
    managed.credential
  );
}

/** Serialize / parse the managed credential record stored in secrets. */
export function serializeManagedCredential(
  managed: ManagedClaudeCredential
): string {
  return JSON.stringify(managed);
}

export function parseManagedCredential(
  raw: string
): ManagedClaudeCredential | null {
  try {
    const root = asRecord(JSON.parse(raw));
    if (!root) {
      return null;
    }
    const credential = root.credential;
    if (typeof credential !== "string" || credential.length === 0) {
      return null;
    }
    return {
      credential,
      oauthAccount: asRecord(root.oauthAccount),
    };
  } catch {
    return null;
  }
}
