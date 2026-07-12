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
  costUsage?: CodexCostUsageSnapshot | null;
  login: CodexLoginState | null;
  revision: number;
  schemaVersion: number;
}

export interface CodexCostUsageSnapshot {
  buckets: Array<{
    date: string;
    estimatedCostMicrousd: number | null;
    pricingStatus: "complete" | "partial" | "unpriced";
    tokens: {
      cachedInputTokens: number;
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      totalTokens: number;
    };
  }>;
  coverage: { complete: boolean; from: string; to: string };
  diagnostics?: {
    candidateFiles: number;
    deduplicatedEvents: number;
    failedFiles: number;
    forkedFiles: number;
    malformedLines: number;
    parsedFiles: number;
    reusedFiles: number;
    truncatedFiles: number;
    uniqueEvents: number;
  };
  observedAt: number;
  summary: {
    estimatedCostMicrousd: number | null;
    latestDayTokens: number;
    periodTokens: number;
    todayEstimatedCostMicrousd: number | null;
  };
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

export interface AddAccountPayload {
  label?: string | undefined;
}

export interface SelectAccountPayload {
  accountId: string;
}

export interface RemoveAccountPayload {
  accountId: string;
}

export interface RefreshUsagePayload {
  accountId?: string | undefined;
}

const nonEmptyStringSchema = z.string().check(z.minLength(1));

export const addAccountPayloadSchema = z.strictObject({
  label: z.optional(nonEmptyStringSchema),
});
export const selectAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
});
export const removeAccountPayloadSchema = selectAccountPayloadSchema;
export const refreshUsagePayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
});
export const emptyRpcPayloadSchema = z.null();
