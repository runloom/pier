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
 * Tools whose OpenAI OAuth credential should be synced alongside the Codex
 * switch. All four tools (codex / opencode / pi / omp) share the same OpenAI
 * OAuth client (`app_EMoamEEZ73f0CkXaXp7hrann`), issuer, and audience — their
 * access/refresh tokens are interchangeable. When the user switches the active
 * Codex account, the same token set can be materialized into the other tools'
 * auth stores so they all use the same ChatGPT account.
 *
 * `"codex"` is always synced (it is the primary target of the switch); the
 * remaining targets are opt-in via the switch confirmation dialog.
 */
export type CrossToolSyncTarget = "codex" | "opencode" | "pi" | "omp";

/** All sync targets, in display order. */
export const ALL_SYNC_TARGETS: readonly Exclude<
  CrossToolSyncTarget,
  "codex"
>[] = ["opencode", "pi", "omp"];

export interface SelectAccountPayload {
  accountId: string;
  /** Optional: which peer tools to sync the credential to. Defaults to none. */
  syncTargets?: readonly CrossToolSyncTarget[] | undefined;
}

export interface RemoveAccountPayload {
  accountId: string;
}

export interface RefreshUsagePayload {
  accountId?: string | undefined;
}

const nonEmptyStringSchema = z.string().check(z.minLength(1));
const syncTargetSchema = z.enum(["codex", "opencode", "pi", "omp"]);

export const addAccountPayloadSchema = z.strictObject({});
export const selectAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
  syncTargets: z.optional(z.array(syncTargetSchema)),
});
export const removeAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
});
export const refreshUsagePayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
});
export const emptyRpcPayloadSchema = z.null();
