import type { CrossToolSyncTarget } from "../shared/accounts.ts";
import {
  extractOauthFromGrokAuth,
  type GrokSyncCredential,
  syncCrossToolCredentials,
} from "./cross-tool-sync.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";

export interface PeerCredentialSyncLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
}

/**
 * Materialize the managed Grok credential into peer tools.
 * Failures are independent per target; the aggregate error message lists them.
 */
export async function syncManagedAccountToPeers(options: {
  accountHomeDir: string;
  accountId: string;
  kind: "api_key" | "oidc";
  label?: string | undefined;
  logger?: PeerCredentialSyncLogger | undefined;
  provider: GrokAccountProvider;
  throwOnFailure?: boolean | undefined;
  syncTargets: readonly CrossToolSyncTarget[];
}): Promise<void> {
  const targets = options.syncTargets.filter((target) => target !== "grok");
  if (targets.length === 0) {
    return;
  }

  try {
    let credential: GrokSyncCredential;
    if (options.kind === "api_key") {
      const apiKey = await options.provider.readApiKey(options.accountId);
      if (!apiKey) {
        throw new Error("Grok API key is missing for peer sync");
      }
      credential = {
        kind: "api_key",
        apiKey,
        ...(options.label ? { label: options.label } : {}),
      };
    } else {
      const authContent = await options.provider.readManagedAuthContent(
        options.accountHomeDir
      );
      credential = extractOauthFromGrokAuth(authContent);
    }

    const results = await syncCrossToolCredentials(targets, credential, {
      ...(options.logger ? { logger: options.logger } : {}),
    });
    const failures = results.filter((result) => !result.ok);
    for (const result of failures) {
      options.logger?.warn(
        `[pier.grok] cross-tool sync failed for ${result.target}`,
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
  } catch (error) {
    if (options.throwOnFailure) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    options.logger?.warn("[pier.grok] cross-tool sync skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
