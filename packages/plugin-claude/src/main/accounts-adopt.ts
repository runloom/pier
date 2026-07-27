import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import type { ClaudeAccountsStateStore } from "./state.ts";

export interface AdoptCurrentDeps {
  clearLastActionError: () => void;
  credentialErrors: Map<string, string>;
  emitSnapshot: () => void;
  ensureManagedDir: (accountId: string) => Promise<string>;
  now: () => number;
  provider: ClaudeAccountProvider;
  refreshUsage: () => void;
  stateStore: ClaudeAccountsStateStore;
}

/**
 * Import the current Claude login into managed accounts and activate it
 * (the CLI-import add path; the OAuth add path is completeLogin).
 */
export async function adoptCurrentClaudeLogin(
  deps: AdoptCurrentDeps
): Promise<void> {
  const identity = await deps.provider.readCurrentIdentity();
  if (!identity) {
    throw new Error(
      "No valid Claude login found. Sign in with the Claude CLI first."
    );
  }
  deps.clearLastActionError();
  const state = deps.stateStore.get();
  const existing = state.accounts.find(
    (a) => a.providerAccountId === identity.providerAccountId
  );
  if (existing) {
    const dir = await deps.ensureManagedDir(existing.id);
    const syncResult = await deps.provider.syncBack(
      dir,
      identity.providerAccountId
    );
    if (syncResult !== "ok") {
      throw new Error("Could not capture the current Claude credential");
    }
    deps.credentialErrors.delete(existing.id);
    deps.stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.map((a) =>
        a.id === existing.id
          ? mergeIdentityIntoAccount(a, identity, deps.now())
          : a
      ),
      activeAccountId: existing.id,
      revision: s.revision + 1,
    }));
  } else {
    const id = randomUUID();
    const dir = await deps.ensureManagedDir(id);
    const syncResult = await deps.provider.syncBack(
      dir,
      identity.providerAccountId
    );
    if (syncResult !== "ok") {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error("Could not capture the current Claude credential");
    }
    const account = buildAccountRecord(identity, id, deps.now());
    deps.stateStore.mutate((s) => ({
      ...s,
      accounts: [...s.accounts, account],
      activeAccountId: id,
      revision: s.revision + 1,
    }));
  }
  await deps.stateStore.flush();
  deps.emitSnapshot();
  deps.refreshUsage();
}
