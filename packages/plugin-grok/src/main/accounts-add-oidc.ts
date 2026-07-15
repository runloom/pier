import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { LOGIN_TIMEOUT_MS, WATCH_SUPPRESS_MS } from "../shared/constants.ts";
import {
  buildOidcAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";
import { classifyLoginError } from "./login-error.ts";
import type { GrokAccountsStateStore } from "./state.ts";

export interface AddOidcAccountHost {
  accountHomeDir(accountId: string): string;
  doRefreshUsage(options: { accountId: string; force: boolean }): Promise<void>;
  emitSnapshot(): void;
  ensureManagedDir(accountId: string): Promise<string>;
  now(): number;
  provider: GrokAccountProvider;
  setLastLoginError(error: { at: number; message: string } | null): void;
  setLoginAbort(abort: AbortController | null): void;
  setLoginMode(mode: "oauth" | "device" | null): void;
  setLoginPending(pending: boolean): void;
  setSuppressWatchUntil(ts: number): void;
  stateStore: GrokAccountsStateStore;
}

interface Compensation {
  name: string;
  run(): Promise<void>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Login cancelled");
  error.name = "AbortError";
  throw error;
}

export async function addOidcAccount(
  host: AddOidcAccountHost,
  mode: "oauth" | "device"
): Promise<void> {
  const id = randomUUID();
  const abort = new AbortController();
  host.setLastLoginError(null);
  host.setLoginPending(true);
  host.setLoginMode(mode);
  host.setLoginAbort(abort);
  host.emitSnapshot();

  let timedOut = false;
  const loginTimeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, LOGIN_TIMEOUT_MS);

  const previousState = host.stateStore.get();
  const compensations: Compensation[] = [];
  let dir = host.accountHomeDir(id);
  let failure: Error | null = null;
  let activatedId: string | null = null;
  let metadataCompensationRegistered = false;

  // These are registered first so every state/auth restoration runs before
  // temporary secret and directory cleanup during reverse-order compensation.
  compensations.push({
    name: "remove temporary account directory",
    run: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  });
  compensations.push({
    name: "delete temporary credential",
    run: async () => {
      await host.provider.deleteCredential(dir);
    },
  });

  const registerMetadataCompensation = (): void => {
    if (metadataCompensationRegistered) return;
    metadataCompensationRegistered = true;
    compensations.push({
      name: "restore account metadata",
      run: async () => {
        host.stateStore.mutate(() => previousState);
        await host.stateStore.flush();
      },
    });
  };

  const materializeWithCompensation = async (
    accountHomeDir: string,
    expectedCurrentAuth: string,
    previousCurrentAuth: string | null
  ): Promise<void> => {
    compensations.push({
      name: "restore current auth",
      run: async () => {
        await host.provider.restoreCurrentAuthContent({
          expectedCurrent: expectedCurrentAuth,
          previousContent: previousCurrentAuth,
        });
      },
    });
    host.setSuppressWatchUntil(host.now() + WATCH_SUPPRESS_MS);
    await host.provider.materializeOidc(accountHomeDir);
    throwIfAborted(abort.signal);
    host.setSuppressWatchUntil(host.now() + WATCH_SUPPRESS_MS);
  };

  try {
    const previousCurrentAuth = await host.provider.readCurrentAuthContent();
    throwIfAborted(abort.signal);
    dir = await host.ensureManagedDir(id);
    throwIfAborted(abort.signal);

    await host.provider.login(dir, abort.signal, mode);
    throwIfAborted(abort.signal);
    const identity = await host.provider.readIdentity(dir);
    throwIfAborted(abort.signal);
    if (!identity) {
      throw new Error("Login completed but no identity found");
    }
    const newAuthContent = await host.provider.readManagedAuthContent(dir);
    throwIfAborted(abort.signal);

    const existing = previousState.accounts.find(
      (account) => account.providerAccountId === identity.providerAccountId
    );
    if (existing) {
      const existingDir = host.accountHomeDir(existing.id);
      const previousManagedAuth =
        await host.provider.readManagedAuthContent(existingDir);
      throwIfAborted(abort.signal);
      compensations.push({
        name: "restore existing managed auth",
        run: async () => {
          await host.provider.writeManagedAuthContent(
            existingDir,
            previousManagedAuth
          );
        },
      });
      await host.provider.moveCredential(dir, existingDir);
      throwIfAborted(abort.signal);
      await rm(dir, { recursive: true, force: true });
      throwIfAborted(abort.signal);

      if (previousState.activeAccountId === existing.id) {
        await materializeWithCompensation(
          existingDir,
          newAuthContent,
          previousCurrentAuth
        );
      }

      registerMetadataCompensation();
      host.stateStore.mutate((state) => ({
        ...state,
        accounts: state.accounts.map((account) =>
          account.id === existing.id
            ? mergeIdentityIntoAccount(
                account,
                identity,
                host.now(),
                host.now()
              )
            : account
        ),
        revision: state.revision + 1,
      }));

      if (previousState.activeAccountId === null) {
        await materializeWithCompensation(
          existingDir,
          newAuthContent,
          previousCurrentAuth
        );
        host.stateStore.mutate((state) => ({
          ...state,
          activeAccountId: existing.id,
          revision: state.revision + 1,
        }));
        activatedId = existing.id;
      }
    } else {
      const account = buildOidcAccountRecord(
        identity,
        id,
        host.now(),
        host.now()
      );
      registerMetadataCompensation();
      host.stateStore.mutate((state) => ({
        ...state,
        accounts: [...state.accounts, account],
        revision: state.revision + 1,
      }));
      if (previousState.activeAccountId === null) {
        await materializeWithCompensation(
          dir,
          newAuthContent,
          previousCurrentAuth
        );
        host.stateStore.mutate((state) => ({
          ...state,
          activeAccountId: id,
          revision: state.revision + 1,
        }));
        activatedId = id;
      }
    }

    await host.stateStore.flush();
    // This post-flush check is also the final pending-lifecycle check: no await
    // may occur between it and clearing the compensation stack to commit.
    throwIfAborted(abort.signal);
    compensations.length = 0;
    host.setLastLoginError(null);
  } catch (error) {
    const classified = classifyLoginError(error, {
      aborted: abort.signal.aborted,
      at: host.now(),
      timedOut,
    });
    const compensationErrors: unknown[] = [];
    for (let index = compensations.length - 1; index >= 0; index -= 1) {
      try {
        await compensations[index]?.run();
      } catch (compensationError) {
        compensationErrors.push(compensationError);
      }
    }
    host.setLastLoginError(classified.errorState);
    failure =
      compensationErrors.length > 0
        ? new AggregateError(
            [classified.failure, ...compensationErrors],
            "Grok account add failed with compensation errors"
          )
        : classified.failure;
  } finally {
    clearTimeout(loginTimeout);
    host.setLoginAbort(null);
    host.setLoginPending(false);
    host.setLoginMode(null);
    host.emitSnapshot();
  }

  if (failure) throw failure;
  if (activatedId) {
    host
      .doRefreshUsage({ accountId: activatedId, force: true })
      .catch(() => undefined);
  }
}
