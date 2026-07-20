import { z } from "zod/mini";

/**
 * Plugin-local Claude account DTOs. Intentionally duplicated from any host
 * contracts so the plugin does not import host modules (mirrors Codex/Grok).
 *
 * Claude Code account management supports:
 * - add via browser OAuth (PKCE, paste authorization code) or importing the
 *   current CLI login
 * - switch = restore a saved credential into the active store
 * - usage via the OAuth usage endpoint Claude Code's `/usage` command uses
 */

export type ClaudeAccountStatus = "active" | "available" | "error";

/** claude.ai subscription tier surfaced from oauthAccount / credential. */
export interface ClaudeSubscriptionSummary {
  /** Organization display name when the account belongs to one. */
  organizationName?: string | undefined;
  /** e.g. "pro", "max", "team", "enterprise", "free". */
  planType: string;
}

export interface ClaudeUsageWindow {
  id: string;
  /** Stable bucket id: "session" / "weekly" / "weekly:<model>". */
  limitId: string;
  /** Human bucket name, e.g. "Session", "Weekly limit", "Opus". */
  limitName?: string | undefined;
  resetsAt?: number | undefined;
  usedPercent: number;
  windowMinutes?: number | undefined;
}

export interface ClaudeUsageSnapshot {
  error?: string | undefined;
  fetchedAt: number;
  status: "ok" | "error";
  windows: ClaudeUsageWindow[];
}

export interface ClaudeAccountSummary {
  email?: string | undefined;
  error?: string | null | undefined;
  id: string;
  label: string;
  status: ClaudeAccountStatus;
  subscription?: ClaudeSubscriptionSummary | undefined;
  /** Last time this account's credential was captured/refreshed (ms epoch). */
  updatedAt?: number | undefined;
  /** null = first usage request not finished; object = completed (ok or error). */
  usage?: ClaudeUsageSnapshot | null | undefined;
}

export interface ClaudeLoginState {
  /** Browser OAuth URL the user must open to authorize Pier. */
  authorizeUrl: string;
  provider: "claude";
  startedAt: number;
}

export interface ClaudeAccountsSnapshot {
  accounts: ClaudeAccountSummary[];
  activeAccountId: string | null;
  activeUsage?: ClaudeUsageSnapshot | null | undefined;
  /**
   * True when the device is configured for API-key auth (ANTHROPIC_API_KEY /
   * `primaryApiKey`) — Claude sessions may not use the managed account.
   */
  apiKeyModeDetected?: boolean | undefined;
  lastActionError?: { at: number; message: string } | null | undefined;
  login: ClaudeLoginState | null;
  revision: number;
  schemaVersion: 1;
}

export interface SelectAccountPayload {
  accountId: string;
}

export interface RemoveAccountPayload {
  accountId: string;
}

export interface CompleteLoginPayload {
  /** `code#state` (or plain code) pasted from the Anthropic callback page. */
  code: string;
}

export interface RefreshUsagePayload {
  accountId?: string | undefined;
  force?: boolean | undefined;
}

export interface UsagePollingPayload {
  consumerId: string;
}

const nonEmptyStringSchema = z.string().check(z.minLength(1));

export const addAccountPayloadSchema = z.strictObject({
  kind: z.optional(z.enum(["oauth", "import"])),
});

export const completeLoginPayloadSchema = z.strictObject({
  code: nonEmptyStringSchema,
});

export const selectAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
});

export const removeAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
});

export const refreshUsagePayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
  force: z.optional(z.boolean()),
});

export const usagePollingPayloadSchema = z.strictObject({
  consumerId: z.string().check(z.minLength(1), z.maxLength(200)),
});

export const emptyRpcPayloadSchema = z.null();
