import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import type { AccountIdentity } from "./identity.ts";
import {
  buildAuthorizeUrl,
  buildCredentialEnvelope,
  createPkcePair,
  exchangeAuthorizationCode,
  type FetchImpl,
  fetchOauthProfile,
  type OauthProfile,
  type PkcePair,
} from "./oauth.ts";
import type { ClaudeAccountsStateStore } from "./state.ts";

export interface OauthLoginSession {
  authorizeUrl: string;
  pkce: PkcePair;
  startedAt: number;
}

export function startOauthLoginSession(now: number): OauthLoginSession {
  const pkce = createPkcePair();
  return {
    authorizeUrl: buildAuthorizeUrl(pkce),
    pkce,
    startedAt: now,
  };
}

const POST_EXCHANGE_ERROR_NAME = "PostExchangeLoginError";

/**
 * The authorization code is consumed by a successful token exchange, so any
 * failure after it cannot be fixed by retrying the same code — the user must
 * re-authorize. Callers use this to restart the login session and pick copy.
 */
export function isPostExchangeLoginError(error: unknown): boolean {
  return error instanceof Error && error.name === POST_EXCHANGE_ERROR_NAME;
}

function postExchangeError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `Claude login could not be completed (${detail}) — re-authorize in the browser and paste the new code`
  );
  error.name = POST_EXCHANGE_ERROR_NAME;
  return error;
}

function identityFromProfile(profile: OauthProfile): AccountIdentity {
  return {
    email: profile.email,
    providerAccountId: profile.accountUuid,
    ...(profile.organizationName
      ? { organizationName: profile.organizationName }
      : {}),
    ...(profile.organizationUuid
      ? { organizationUuid: profile.organizationUuid }
      : {}),
    ...(profile.subscriptionType
      ? { subscriptionType: profile.subscriptionType }
      : {}),
  };
}

/** oauthAccount block to restore into `~/.claude.json` on materialize. */
function oauthAccountFromProfile(
  profile: OauthProfile
): Record<string, unknown> {
  return {
    accountUuid: profile.accountUuid,
    emailAddress: profile.email,
    ...(profile.organizationName
      ? { organizationName: profile.organizationName }
      : {}),
    ...(profile.organizationUuid
      ? { organizationUuid: profile.organizationUuid }
      : {}),
  };
}

export interface CompleteOauthLoginDeps {
  accountHomeDir: (accountId: string) => string;
  ensureManagedDir: (accountId: string) => Promise<string>;
  fetchImpl?: FetchImpl | undefined;
  materialize: (accountId: string) => Promise<void>;
  now: () => number;
  provider: Pick<ClaudeAccountProvider, "deleteCredential" | "importAccount">;
  stateStore: ClaudeAccountsStateStore;
}

/**
 * Exchange the pasted authorization code, resolve identity, store the managed
 * credential, and activate the account (dedupe by accountUuid — a re-login of
 * a known account updates it instead of duplicating).
 */
export async function completeOauthLogin(
  deps: CompleteOauthLoginDeps,
  session: OauthLoginSession,
  pastedCode: string,
  signal: AbortSignal
): Promise<void> {
  const fetchImpl: FetchImpl = deps.fetchImpl ?? fetch;
  const tokens = await exchangeAuthorizationCode({
    fetchImpl,
    now: deps.now,
    pastedCode,
    signal,
    verifier: session.pkce.verifier,
  });
  try {
    await storeAndActivate(deps, fetchImpl, tokens, signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw postExchangeError(error);
  }
}

async function storeAndActivate(
  deps: CompleteOauthLoginDeps,
  fetchImpl: FetchImpl,
  tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>,
  signal: AbortSignal
): Promise<void> {
  const profile = await fetchOauthProfile({
    accessToken: tokens.accessToken,
    fetchImpl,
    signal,
  });
  const identity = identityFromProfile(profile);
  const envelope = buildCredentialEnvelope(tokens, profile.subscriptionType);
  const oauthAccount = oauthAccountFromProfile(profile);

  const state = deps.stateStore.get();
  const existing = state.accounts.find(
    (account) => account.providerAccountId === identity.providerAccountId
  );
  if (existing) {
    const dir = await deps.ensureManagedDir(existing.id);
    await deps.provider.importAccount(dir, envelope, oauthAccount);
    deps.stateStore.mutate((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.id === existing.id
          ? mergeIdentityIntoAccount(account, identity, deps.now())
          : account
      ),
      revision: current.revision + 1,
    }));
    await deps.stateStore.flush();
    await deps.materialize(existing.id);
    return;
  }

  const previousActiveId = state.activeAccountId;
  const id = randomUUID();
  const dir = await deps.ensureManagedDir(id);
  try {
    await deps.provider.importAccount(dir, envelope, oauthAccount);
    deps.stateStore.mutate((current) => ({
      ...current,
      accounts: [
        ...current.accounts,
        buildAccountRecord(identity, id, deps.now()),
      ],
      revision: current.revision + 1,
    }));
    await deps.stateStore.flush();
    await deps.materialize(id);
  } catch (error) {
    // Roll back the half-created account: remove the ghost row, restore the
    // previously active selection, and delete the stored secret so no orphan
    // credential outlives its account dir.
    deps.stateStore.mutate((current) => ({
      ...current,
      accounts: current.accounts.filter((account) => account.id !== id),
      activeAccountId:
        current.activeAccountId === id
          ? previousActiveId
          : current.activeAccountId,
      revision: current.revision + 1,
    }));
    await deps.stateStore.flush().catch(() => undefined);
    await deps.provider.deleteCredential(dir).catch(() => undefined);
    await rm(dir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
}
