import type { CrossToolSyncTarget } from "../shared/accounts.ts";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import {
  extractTokensFromClaudeEnvelope,
  type SyncTargetResult,
  syncCrossToolCredentials,
} from "./cross-tool-sync.ts";

export interface PeerCredentialSyncLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
}

/**
 * Materialize a managed Claude credential into peer tools.
 * Failures are independent per target; per-target results are returned so
 * callers can surface partial failures instead of hiding them in the log.
 */
export async function syncManagedAccountToPeers(options: {
  accountHomeDir: string;
  /** Anthropic account uuid when known (omp identity_key / peer metadata). */
  accountUuid?: string | undefined;
  email?: string | undefined;
  logger?: PeerCredentialSyncLogger | undefined;
  provider: ClaudeAccountProvider;
  throwOnFailure?: boolean | undefined;
  syncTargets: readonly CrossToolSyncTarget[];
}): Promise<SyncTargetResult[]> {
  const targets = options.syncTargets.filter((target) => target !== "claude");
  if (targets.length === 0) {
    return [];
  }

  try {
    const envelope = await options.provider.readManagedCredentialRaw(
      options.accountHomeDir
    );
    if (!envelope) {
      throw new Error("No stored Claude credential for this account");
    }
    const tokens = extractTokensFromClaudeEnvelope(envelope, {
      ...(options.accountUuid ? { accountId: options.accountUuid } : {}),
      ...(options.email ? { email: options.email } : {}),
    });

    const results = await syncCrossToolCredentials(targets, tokens, {
      ...(options.logger ? { logger: options.logger } : {}),
    });
    const failures = results.filter((result) => !result.ok);
    for (const result of failures) {
      options.logger?.warn(
        `[pier.claude] cross-tool sync failed for ${result.target}`,
        { error: result.error }
      );
    }
    if (options.throwOnFailure && failures.length > 0) {
      throw new Error(
        failures
          .map(
            (result) => `${result.target}: ${result.error ?? "unknown error"}`
          )
          .join("; ")
      );
    }
    return results;
  } catch (error) {
    if (options.throwOnFailure) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    const message = error instanceof Error ? error.message : String(error);
    options.logger?.warn("[pier.claude] cross-tool sync skipped", {
      error: message,
    });
    return targets.map((target) => ({ target, ok: false, error: message }));
  }
}
