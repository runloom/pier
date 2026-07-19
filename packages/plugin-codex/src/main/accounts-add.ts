import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { LOGIN_TIMEOUT_MS } from "../shared/constants.ts";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import { classifyLoginError } from "./login-error.ts";
import type { CodexAccountRecord, CodexAccountsStateStore } from "./state.ts";
import type { AgentAccountProvider } from "./types.ts";

export interface AddCodexAccountHost {
  accountHomeDir(accountId: string): string;
  doRefreshUsage(options: { accountId: string; force: boolean }): Promise<void>;
  emitSnapshot(): void;
  ensureManagedDir(accountId: string): Promise<string>;
  now(): number;
  provider: AgentAccountProvider;
  setLastLoginError(error: { at: number; message: string } | null): void;
  setLoginAbort(abort: AbortController | null): void;
  setLoginPending(pending: "codex" | null): void;
  setLoginStartedAt(startedAt: number | null): void;
  setSuppressWatchUntil(ts: number): void;
  stateStore: CodexAccountsStateStore;
  watchSuppressMs: number;
}

/**
 * Browser-login add flow. Uses targeted rollback bookkeeping: usage refresh
 * legitimately mutates account metadata outside the mutation queue while the
 * (minutes-long) login is in flight, so restoring a whole pre-login snapshot
 * on failure would silently revert those writes.
 */
export async function addCodexAccount(
  host: AddCodexAccountHost,
  /** Login abort controller, created by the service at enqueue time so a
   *  cancel issued while this operation is still queued is not lost. */
  abort: AbortController
): Promise<void> {
  const { provider, stateStore } = host;
  const now = host.now;
  const id = randomUUID();
  const dir = await host.ensureManagedDir(id);
  host.setLastLoginError(null);
  host.setLoginPending("codex");
  host.setLoginStartedAt(now());
  host.setLoginAbort(abort);
  host.emitSnapshot();

  let timedOut = false;
  const loginTimeout = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, LOGIN_TIMEOUT_MS);

  let failure: Error | null = null;
  let rollback: (() => void) | null = null;
  let existingId: string | null = null;
  try {
    await provider.login(dir, abort.signal);
    const identity = await provider.readIdentity(dir);
    if (!identity) {
      throw new Error("Login completed but no identity found");
    }
    // Look up duplicates against the *current* state: an account may have
    // gained this providerAccountId (via identity backfill) during login.
    const state = stateStore.get();
    const existing = identity.providerAccountId
      ? state.accounts.find(
          (a) => a.providerAccountId === identity.providerAccountId
        )
      : null;
    if (existing) {
      existingId = existing.id;
      const existingDir = host.accountHomeDir(existing.id);
      if (provider.moveCredential) {
        await provider.moveCredential(dir, existingDir);
      } else {
        const freshAuth = await readFile(join(dir, "auth.json"), "utf-8");
        await writeFileAtomic(join(existingDir, "auth.json"), freshAuth, {
          mode: 0o600,
        });
      }
      await rm(dir, { recursive: true, force: true });
      if (stateStore.get().activeAccountId === existing.id) {
        host.setSuppressWatchUntil(now() + host.watchSuppressMs);
        await provider.materialize(existingDir);
        host.setSuppressWatchUntil(now() + host.watchSuppressMs);
      }
      const before: CodexAccountRecord = existing;
      rollback = () => {
        stateStore.mutate((s) => ({
          ...s,
          accounts: s.accounts.map((a) => (a.id === before.id ? before : a)),
          revision: s.revision + 1,
        }));
      };
      stateStore.mutate((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === existing.id
            ? mergeIdentityIntoAccount(a, identity, now(), now())
            : a
        ),
        revision: s.revision + 1,
      }));
    } else {
      const account = buildAccountRecord(identity, id, now(), now());
      rollback = () => {
        stateStore.mutate((s) => ({
          ...s,
          accounts: s.accounts.filter((a) => a.id !== id),
          revision: s.revision + 1,
        }));
      };
      stateStore.mutate((s) => ({
        ...s,
        accounts: [...s.accounts, account],
        revision: s.revision + 1,
      }));
    }
    await stateStore.flush();
    host.setLastLoginError(null);
  } catch (err) {
    let rollbackError: unknown = null;
    if (rollback) {
      rollback();
      try {
        await stateStore.flush();
      } catch (error) {
        rollbackError = error;
      }
    }
    await provider.deleteCredential?.(dir);
    await rm(dir, { recursive: true, force: true }).catch(() => {
      /* fire-and-forget */
    });
    const classified = classifyLoginError(err, {
      aborted: abort.signal.aborted,
      at: now(),
      timedOut,
    });
    host.setLastLoginError(classified.errorState);
    failure = rollbackError
      ? new AggregateError(
          [classified.failure, rollbackError],
          "Codex account add and metadata rollback failed"
        )
      : classified.failure;
  } finally {
    clearTimeout(loginTimeout);
    host.setLoginAbort(null);
    host.setLoginPending(null);
    host.setLoginStartedAt(null);
    host.emitSnapshot();
  }
  if (failure) {
    throw failure;
  }
  // Refresh usage for the added (or merged) account so the UI does not stay
  // skeleton. If the account was not activated, this still fills the cache.
  const refreshId = existingId ?? id;
  host
    .doRefreshUsage({ accountId: refreshId, force: true })
    .catch(() => undefined);
}
