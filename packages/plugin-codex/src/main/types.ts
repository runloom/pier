import type { AccountIdentity } from "./identity.ts";

export type AgentAccountProviderId = "codex";

/** provider 内部接口. */
export interface AgentAccountProvider {
  fetchUsage(signal: AbortSignal): Promise<AccountUsageResult>;
  readonly id: AgentAccountProviderId;
  login(homeDir: string, signal: AbortSignal): Promise<void>;
  materialize(accountHomeDir: string): Promise<void>;
  readIdentity(homeDir: string): Promise<AccountIdentity | null>;
  syncBack(
    accountHomeDir: string,
    expectedProviderAccountId: string | undefined
  ): Promise<"identity-mismatch" | "ok">;
  watchExternalAuth(cb: () => void): () => void;
}

export interface AccountUsageResult {
  error?: string;
  session?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
  status: "error" | "ok";
  weekly?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
}
