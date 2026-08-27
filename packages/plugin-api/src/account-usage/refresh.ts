import type { ExternalRendererPluginContext } from "../renderer.ts";

/** Shared i18n callback shape for settings hook + widget action factory. */
export type AccountUsageTranslate = (key: string, fallback: string) => string;

/**
 * Thrown when a manual "refresh active account" is requested but the snapshot
 * has no activeAccountId. Callers map this to a user-facing alert (no success
 * toast — an empty refresh is not success).
 */
export class NoActiveAccountError extends Error {
  readonly code = "no-active-account" as const;

  constructor(message = "No active account") {
    super(message);
    this.name = "NoActiveAccountError";
  }
}

export function isNoActiveAccountError(error: unknown): boolean {
  if (error instanceof NoActiveAccountError) return true;
  if (typeof error !== "object" || error === null) return false;
  return (
    "code" in error && (error as { code: unknown }).code === "no-active-account"
  );
}

/** Non-empty account id, or undefined when omitted/blank. */
export function normalizeAccountId(
  accountId: string | undefined
): string | undefined {
  if (accountId === undefined) return;
  const trimmed = accountId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface RefreshAccountUsageOptions {
  /** Target a specific managed account; omit/blank to refresh the active account. */
  accountId?: string;
  /**
   * When true and no target `accountId` is provided, load a snapshot first and
   * throw {@link NoActiveAccountError} if there is no active account.
   *
   * Widget header refresh always enables this so a success toast never appears
   * next to an empty meter. Settings always pass an explicit non-empty
   * `accountId`, so the guard stays off.
   *
   * The snapshot is re-fetched on purpose (not read from the widget store): a
   * user can clear the active account between paint and click.
   */
  requireActiveAccount?: boolean;
}

/**
 * Single source of truth for manual usage refresh RPC.
 *
 * Always sends `force: true` so the main min-refetch window cannot swallow a
 * user click. Settings buttons must call this (via {@link useAccountsRefresh})
 * — do not re-inline the RPC.
 *
 * This is the manual-refresh contract only. Automatic polling still goes
 * through the usage-polling lease + main scheduler (not this function).
 */
export async function refreshAccountUsage(
  context: ExternalRendererPluginContext,
  options: RefreshAccountUsageOptions = {}
): Promise<void> {
  const accountId = normalizeAccountId(options.accountId);

  if (options.requireActiveAccount === true && accountId === undefined) {
    const snapshot = await context.rpc.invoke<{
      activeAccountId: string | null;
    }>("accounts.snapshot", null);
    if (!snapshot.activeAccountId) {
      throw new NoActiveAccountError();
    }
  }

  await context.rpc.invoke("accounts.refreshUsage", {
    ...(accountId ? { accountId } : {}),
    force: true,
  });
}

/**
 * Manual "refresh all accounts" RPC.
 *
 * Client payload is empty (`null`); each plugin main handler must pass
 * `force: true` into its service-level refresh-all (Codex/Grok/Claude do).
 */
export async function refreshAllAccountUsage(
  context: ExternalRendererPluginContext
): Promise<void> {
  await context.rpc.invoke("accounts.refreshAllUsage", null);
}
