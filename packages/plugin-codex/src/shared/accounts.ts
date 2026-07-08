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

export interface CodexUsageSnapshot {
  fetchedAt: number;
  raw: unknown;
}

export interface CodexAccountSummary {
  error?: string | null;
  id: string;
  label: string;
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

export interface AddAccountPayload {
  label?: string;
}

export interface SelectAccountPayload {
  accountId: string;
}

export interface RemoveAccountPayload {
  accountId: string;
}
