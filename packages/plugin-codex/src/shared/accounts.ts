import { z } from "zod/mini";

/**
 * Plugin-local Codex account DTOs (plan Task 9). Duplicated intentionally
 * from `@shared/contracts/agent-accounts.ts` so the plugin does not import
 * host contracts.
 */

export type CodexAccountStatus =
  | "active"
  | "available"
  | "login-pending"
  | "error";

export interface CodexUsageWindow {
  id: string;
  limitId: string;
  limitName?: string;
  resetsAt?: number;
  usedPercent: number;
  windowMinutes?: number;
}

export interface CodexUsageSnapshot {
  error?: string;
  fetchedAt: number;
  raw?: unknown;
  resetCreditsAvailable?: number;
  status: "ok" | "error";
  windows: CodexUsageWindow[];
}

export interface CodexAccountSummary {
  error?: string | null;
  id: string;
  label: string;
  planType?: string;
  status: CodexAccountStatus;
  /** null 表示尚未完成首次用量请求；对象表示请求已完成（包括空结果或错误）。 */
  usage?: CodexUsageSnapshot | null;
}

export interface CodexLoginState {
  provider: "codex";
  startedAt: number;
}

export interface CodexAccountsSnapshot {
  accounts: CodexAccountSummary[];
  activeAccountId: string | null;
  activeUsage?: CodexUsageSnapshot | null;
  login: CodexLoginState | null;
  revision: number;
  schemaVersion: number;
}

export interface CodexAccountsState {
  accounts: Array<{
    error?: string | null;
    id: string;
    label: string;
    status: CodexAccountStatus;
  }>;
  activeAccountId: string | null;
  revision: number;
  schemaVersion: number;
}

export type AddAccountPayload = Record<string, never>;

/**
 * Tools that can receive a mirrored OpenAI OAuth credential from a managed
 * Codex account. All four tools (codex / opencode / pi / omp) share the same
 * OpenAI OAuth client, issuer, and audience — their access/refresh tokens are
 * interchangeable.
 *
 * - On account switch, `"codex"` is always handled by materialize; peer tools
 *   are optional via the switch confirmation dialog.
 * - `accounts.syncToPeers` only accepts peer tools and never changes the
 *   active Codex account.
 */
export type CrossToolSyncTarget = "codex" | "opencode" | "pi" | "omp";

/** Peer tools only, in display order. */
export const ALL_SYNC_TARGETS: readonly Exclude<
  CrossToolSyncTarget,
  "codex"
>[] = ["opencode", "pi", "omp"];

export type PeerSyncTarget = (typeof ALL_SYNC_TARGETS)[number];

export interface SelectAccountPayload {
  accountId: string;
  /** Optional peer tools to mirror credentials into. Defaults to none. */
  syncTargets?: readonly PeerSyncTarget[] | undefined;
}

export interface SyncToPeersPayload {
  /**
   * Managed account to read credentials from. Defaults to the current active
   * managed account. System default (`null` active) is not supported.
   */
  accountId?: string | undefined;
  /** Peer tools to update. Must contain at least one entry. */
  syncTargets: readonly PeerSyncTarget[];
}

export interface RemoveAccountPayload {
  accountId: string;
}

export interface RefreshUsagePayload {
  accountId?: string | undefined;
}

const nonEmptyStringSchema = z.string().check(z.minLength(1));
const peerSyncTargetSchema = z.enum(["opencode", "pi", "omp"]);

export const addAccountPayloadSchema = z.strictObject({});
export const selectAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
  syncTargets: z.optional(z.array(peerSyncTargetSchema)),
});
export const syncToPeersPayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
  syncTargets: z.array(peerSyncTargetSchema).check(z.minLength(1)),
});
export const removeAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
});
export const refreshUsagePayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
});
export const emptyRpcPayloadSchema = z.null();
