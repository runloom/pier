import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { WATCH_SUPPRESS_MS } from "../shared/constants.ts";
import { buildApiKeyAccountRecord } from "./accounts-records.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";
import type { GrokAccountsStateStore } from "./state.ts";

export interface AddApiKeyAccountHost {
  adoptCurrent(): Promise<void>;
  clearLastLoginError(): void;
  doRefreshUsage(options: { accountId: string; force: boolean }): Promise<void>;
  emitSnapshot(): void;
  ensureManagedDir(accountId: string): Promise<string>;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  now(): number;
  provider: GrokAccountProvider;
  setSuppressWatchUntil(ts: number): void;
  stateStore: GrokAccountsStateStore;
}

/**
 * Add (and possibly activate) an API-key account.
 *
 * Activation writes `"{}"` over the real auth.json, so it only happens when
 * the real home is confirmed free of an external login: an unadopted external
 * login is adopted first, and if that adoption *fails*, activation is skipped
 * entirely — failing to capture credentials must not fall through to
 * destroying them.
 */
export async function addApiKeyAccount(
  host: AddApiKeyAccountHost,
  apiKey: string,
  label?: string
): Promise<void> {
  const { provider, stateStore, logger } = host;
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new Error("API key must not be empty");
  }
  const id = randomUUID();
  const dir = await host.ensureManagedDir(id);
  const displayLabel =
    typeof label === "string" && label.trim().length > 0
      ? label.trim()
      : "API key";
  let accountAdded = false;
  let activatedFrom: { previousActiveId: string | null } | null = null;
  try {
    await provider.storeApiKey(id, trimmed);
    const account = buildApiKeyAccountRecord(id, displayLabel, host.now());
    stateStore.mutate((s) => ({
      ...s,
      accounts: [...s.accounts, account],
      revision: s.revision + 1,
    }));
    accountAdded = true;
    if (stateStore.get().activeAccountId === null) {
      // An unadopted external login may still sit in the real auth.json
      // (e.g. a drift event that fell into the suppression window). Adopt
      // it instead of wiping it with an empty auth file.
      const externalIdentity = await provider
        .readCurrentIdentity()
        .catch(() => null);
      let adopted = false;
      if (externalIdentity) {
        adopted = await host.adoptCurrent().then(
          () => true,
          (adoptError: unknown) => {
            logger?.warn(
              "[pier.grok] could not adopt external login before API key activation",
              {
                error:
                  adoptError instanceof Error
                    ? adoptError.message
                    : String(adoptError),
              }
            );
            return false;
          }
        );
      }
      if (
        (!externalIdentity || adopted) &&
        stateStore.get().activeAccountId === null
      ) {
        activatedFrom = { previousActiveId: null };
        host.setSuppressWatchUntil(host.now() + WATCH_SUPPRESS_MS);
        await provider.materializeEmptyAuth();
        host.setSuppressWatchUntil(host.now() + WATCH_SUPPRESS_MS);
        stateStore.mutate((s) => ({
          ...s,
          activeAccountId: id,
          revision: s.revision + 1,
        }));
      }
    }
    await stateStore.flush();
    host.clearLastLoginError();
    host.emitSnapshot();
    // Always refresh — even non-activated accounts need a cache entry to
    // leave the skeleton state. API keys return a known error result.
    host.doRefreshUsage({ accountId: id, force: true }).catch(() => undefined);
  } catch (error) {
    // Targeted rollback: remove exactly what this operation added instead
    // of restoring a whole pre-operation snapshot (which would clobber
    // concurrent usage-refresh metadata writes).
    if (accountAdded) {
      stateStore.mutate((s) => ({
        ...s,
        accounts: s.accounts.filter((a) => a.id !== id),
        ...(activatedFrom && s.activeAccountId === id
          ? { activeAccountId: activatedFrom.previousActiveId }
          : {}),
        revision: s.revision + 1,
      }));
      await stateStore.flush().catch(() => undefined);
    }
    await provider.deleteApiKey(id);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
