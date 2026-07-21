import type { CrossToolSyncTarget } from "../shared/accounts.ts";
import {
  extractTokenSetFromCodexAuth,
  type SyncTargetResult,
  syncCrossToolCredentials,
} from "./cross-tool-sync.ts";
import type { AgentAccountProvider } from "./types.ts";

export interface PeerCredentialSyncLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
}

/**
 * Materialize the managed Codex OAuth token into peer tools.
 * Failures are independent per target; per-target results are returned so
 * callers can surface partial failures to the user instead of hiding them
 * in the log.
 */
export async function syncManagedAccountToPeers(options: {
  accountHomeDir: string;
  email?: string | undefined;
  logger?: PeerCredentialSyncLogger | undefined;
  provider: AgentAccountProvider;
  /** When true, throw if any target fails. Select keeps switch best-effort. */
  throwOnFailure?: boolean | undefined;
  syncTargets: readonly CrossToolSyncTarget[];
}): Promise<SyncTargetResult[]> {
  const targets = options.syncTargets.filter((target) => target !== "codex");
  if (targets.length === 0) {
    return [];
  }

  try {
    const authContent = await options.provider.readManagedAuthContent(
      options.accountHomeDir
    );
    const tokens = extractTokenSetFromCodexAuth(authContent, options.email);
    const results = await syncCrossToolCredentials(targets, tokens, {
      ...(options.logger ? { logger: options.logger } : {}),
    });
    const failures = results.filter((result) => !result.ok);
    for (const result of failures) {
      options.logger?.warn(
        `[pier.codex] cross-tool sync failed for ${result.target}`,
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
    options.logger?.warn("[pier.codex] cross-tool sync skipped", {
      error: message,
    });
    // Token extraction failed before any target write — every requested
    // target failed with the same cause.
    return targets.map((target) => ({ target, ok: false, error: message }));
  }
}
