import { mergeIdentityIntoAccount } from "./accounts-records.ts";
import type { AccountIdentity } from "./identity.ts";
import type { CodexAccountRecord, CodexAccountsStateStore } from "./state.ts";

function identityFieldsEqual(
  left: CodexAccountRecord,
  right: CodexAccountRecord
): boolean {
  return (
    left.email === right.email &&
    left.planType === right.planType &&
    left.providerAccountId === right.providerAccountId &&
    left.subscriptionExpiresAt === right.subscriptionExpiresAt
  );
}

/**
 * Soft-refresh plan/email/subscription expiry from managed auth.json identity.
 * Used on usage refresh so legacy records pick up new id_token claims without
 * requiring re-login.
 */
export async function refreshManagedAccountIdentity(options: {
  accountHomeDir: (accountId: string) => string;
  accountId: string;
  now: () => number;
  readIdentity: (homeDir: string) => Promise<AccountIdentity | null>;
  stateStore: CodexAccountsStateStore;
}): Promise<boolean> {
  const account = options.stateStore
    .get()
    .accounts.find((entry) => entry.id === options.accountId);
  if (!account) return false;

  const identity = await options.readIdentity(
    options.accountHomeDir(options.accountId)
  );
  if (!identity) return false;

  const merged = mergeIdentityIntoAccount(account, identity, options.now());
  if (identityFieldsEqual(account, merged)) {
    return false;
  }

  options.stateStore.mutate((state) => ({
    ...state,
    accounts: state.accounts.map((entry) =>
      entry.id === options.accountId ? merged : entry
    ),
    revision: state.revision + 1,
  }));
  await options.stateStore.flush();
  return true;
}
