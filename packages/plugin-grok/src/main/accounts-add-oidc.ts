import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { LOGIN_TIMEOUT_MS, WATCH_SUPPRESS_MS } from "../shared/constants.ts";
import {
  buildOidcAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import {
  type DeviceLoginInfo,
  parseDeviceLoginOutput,
} from "./device-login-output.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";
import { classifyLoginError } from "./login-error.ts";
import type { GrokAccountRecord, GrokAccountsStateStore } from "./state.ts";

export interface AddOidcAccountHost {
  accountHomeDir(accountId: string): string;
  doRefreshUsage(options: { accountId: string; force: boolean }): Promise<void>;
  emitSnapshot(): void;
  ensureManagedDir(accountId: string): Promise<string>;
  now(): number;
  provider: GrokAccountProvider;
  setLastLoginError(error: { at: number; message: string } | null): void;
  setLoginAbort(abort: AbortController | null): void;
  setLoginDeviceInfo(info: DeviceLoginInfo | null): void;
  setLoginMode(mode: "oauth" | "device" | null): void;
  setLoginPending(pending: boolean): void;
  setLoginStartedAt(startedAt: number | null): void;
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
  mode: "oauth" | "device",
  /** Login abort controller, created by the service at enqueue time so a
   *  cancel issued while this operation is still queued is not lost. */
  abort: AbortController = new AbortController()
): Promise<void> {
  const id = randomUUID();
  host.setLastLoginError(null);
  host.setLoginPending(true);
  host.setLoginMode(mode);
  host.setLoginStartedAt(host.now());
  host.setLoginDeviceInfo(null);
  host.setLoginAbort(abort);
  host.emitSnapshot();

  let timedOut = false;
  const loginTimeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, LOGIN_TIMEOUT_MS);

  const compensations: Compensation[] = [];
  let dir = host.accountHomeDir(id);
  let failure: Error | null = null;
  let activatedId: string | null = null;
  let existingId: string | null = null;

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

  // Targeted reverse mutations instead of restoring a whole pre-login state
  // snapshot: usage refresh legitimately mutates account metadata outside the
  // mutation queue while the (minutes-long) login is in flight, and a
  // wholesale restore would silently revert those writes.
  const registerAddedAccountCompensation = (accountId: string): void => {
    compensations.push({
      name: "remove added account metadata",
      run: async () => {
        host.stateStore.mutate((state) => ({
          ...state,
          accounts: state.accounts.filter(
            (account) => account.id !== accountId
          ),
          revision: state.revision + 1,
        }));
        await host.stateStore.flush();
      },
    });
  };
  const registerMergedAccountCompensation = (
    before: GrokAccountRecord
  ): void => {
    compensations.push({
      name: "restore merged account metadata",
      run: async () => {
        host.stateStore.mutate((state) => ({
          ...state,
          accounts: state.accounts.map((account) =>
            account.id === before.id ? before : account
          ),
          revision: state.revision + 1,
        }));
        await host.stateStore.flush();
      },
    });
  };
  const registerActiveAccountCompensation = (
    previousActiveId: string | null
  ): void => {
    compensations.push({
      name: "restore active account selection",
      run: async () => {
        host.stateStore.mutate((state) => ({
          ...state,
          activeAccountId: previousActiveId,
          revision: state.revision + 1,
        }));
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

  // Device-code login prints the verification URL and user code to stdout —
  // invisible in a GUI app unless captured and surfaced via the snapshot.
  let outputBuffer = "";
  let publishedDeviceInfo = "";
  const handleLoginOutput = (chunk: string): void => {
    if (mode !== "device") return;
    outputBuffer = (outputBuffer + chunk).slice(-8192);
    const info = parseDeviceLoginOutput(outputBuffer);
    const fingerprint = `${info.deviceVerificationUrl ?? ""}\n${info.deviceCode ?? ""}`;
    if (
      (info.deviceCode || info.deviceVerificationUrl) &&
      fingerprint !== publishedDeviceInfo
    ) {
      publishedDeviceInfo = fingerprint;
      host.setLoginDeviceInfo(info);
      host.emitSnapshot();
    }
  };

  try {
    throwIfAborted(abort.signal);
    const previousCurrentAuth = await host.provider.readCurrentAuthContent();
    throwIfAborted(abort.signal);
    dir = await host.ensureManagedDir(id);
    throwIfAborted(abort.signal);

    await host.provider.login(dir, abort.signal, mode, handleLoginOutput);
    throwIfAborted(abort.signal);
    const identity = await host.provider.readIdentity(dir);
    throwIfAborted(abort.signal);
    if (!identity) {
      throw new Error("Login completed but no identity found");
    }
    const newAuthContent = await host.provider.readManagedAuthContent(dir);
    throwIfAborted(abort.signal);

    // Look up duplicates against the *current* state: an account may have
    // gained this providerAccountId (via identity backfill) during the login.
    const stateAfterLogin = host.stateStore.get();
    const existing = stateAfterLogin.accounts.find(
      (account) => account.providerAccountId === identity.providerAccountId
    );
    const previousActiveId = stateAfterLogin.activeAccountId;
    if (existing) {
      existingId = existing.id;
      const existingDir = host.accountHomeDir(existing.id);
      const previousManagedAuth =
        await host.provider.readManagedAuthContent(existingDir);
      throwIfAborted(abort.signal);
      compensations.push({
        name: "restore existing managed auth",
        run: async () => {
          // Three-way check: only restore when the store still holds the
          // content this login moved in. A usage refresh may have rotated
          // the session concurrently — restoring the stale capture would
          // discard a possibly single-use rotated refresh token.
          const current =
            await host.provider.readManagedAuthContent(existingDir);
          if (current === newAuthContent) {
            await host.provider.writeManagedAuthContent(
              existingDir,
              previousManagedAuth
            );
          }
        },
      });
      await host.provider.moveCredential(dir, existingDir);
      throwIfAborted(abort.signal);
      await rm(dir, { recursive: true, force: true });
      throwIfAborted(abort.signal);

      if (previousActiveId === existing.id) {
        await materializeWithCompensation(
          existingDir,
          newAuthContent,
          previousCurrentAuth
        );
      }

      const mergedBefore = existing;
      registerMergedAccountCompensation(mergedBefore);
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

      if (previousActiveId === null) {
        await materializeWithCompensation(
          existingDir,
          newAuthContent,
          previousCurrentAuth
        );
        registerActiveAccountCompensation(previousActiveId);
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
      registerAddedAccountCompensation(id);
      host.stateStore.mutate((state) => ({
        ...state,
        accounts: [...state.accounts, account],
        revision: state.revision + 1,
      }));
      if (previousActiveId === null) {
        await materializeWithCompensation(
          dir,
          newAuthContent,
          previousCurrentAuth
        );
        registerActiveAccountCompensation(previousActiveId);
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
    host.setLoginStartedAt(null);
    host.setLoginDeviceInfo(null);
    host.emitSnapshot();
  }
  if (failure) throw failure;
  // Always refresh usage for the account that was added (or merged into).
  // Without this, a non-activated new account stays skeleton until manual refresh.
  const refreshId = activatedId ?? existingId ?? id;
  host
    .doRefreshUsage({ accountId: refreshId, force: true })
    .catch(() => undefined);
}
