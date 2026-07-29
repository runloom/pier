import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import type { AccountIdentity } from "./identity.ts";

export type AgentAccountProviderId = "codex";

/** provider 内部接口. */
export interface AgentAccountProvider {
  deleteCredential?(accountHomeDir: string): Promise<void>;
  fetchUsage(
    accountHomeDir: string | undefined,
    signal: AbortSignal
  ): Promise<AccountUsageResult>;
  readonly id: AgentAccountProviderId;
  login(homeDir: string, signal: AbortSignal): Promise<void>;
  materialize(accountHomeDir: string): Promise<void>;
  moveCredential?(fromHomeDir: string, toHomeDir: string): Promise<void>;
  readCurrentIdentity(): Promise<AccountIdentity | null>;
  readIdentity(homeDir: string): Promise<AccountIdentity | null>;
  /**
   * Read the managed auth.json content for an account. Returns the raw
   * JSON string (the same content that `materialize` writes to
   * `~/.codex/auth.json`). Used by cross-tool sync to extract tokens.
   */
  readManagedAuthContent(accountHomeDir: string): Promise<string>;
  syncBack(
    accountHomeDir: string,
    expectedProviderAccountId: string | undefined
  ): Promise<"identity-mismatch" | "ok">;
  watchExternalAuth(cb: () => void): () => void;
}

export interface AccountUsageResult {
  error?: string;
  /** True when accounts/check or subscriptions resolved membership. */
  membershipResolved?: boolean;
  metrics: AccountUsageMetric[];
  /** Live ChatGPT plan from account/rateLimits/read (authoritative over JWT). */
  planType?: string;
  status: "error" | "ok";
  /** Live ChatGPT subscription period end (ms epoch). */
  subscriptionExpiresAt?: number;
}
