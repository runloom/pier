# Account Plugin Hardening Design

**Date:** 2026-07-15

## Goal

Bring the current Codex/Grok account-plugin changes to a production-grade end state: account mutations remain consistent across metadata, managed secrets, and the real Grok home; OMP credential switches are atomic; usage retrieval tolerates supported schema and transport variation; every managed plugin development watcher has an explicit lifecycle; and the changed code passes repository quality gates.

## Scope

This design covers only the current uncommitted account-plugin changes and their directly required tests:

- Grok OIDC account creation, cancellation, rollback, and cleanup.
- Codex and Grok OMP credential selection.
- Grok credits parsing, endpoint fallback, and 403 classification.
- Bundled official plugin registration and development watcher ownership.
- Formatting and regression tests for the changed behavior.

Unchanged repository baseline failures are out of scope: the unsigned committed official index requires signing-key ownership, and `packages/ui/src/chart.tsx` requires an unrelated component decomposition.

## 1. Grok OIDC mutation boundary

`addOidcAccount` remains a focused operation module, but its mutation semantics become an operation-scoped compensating transaction.

### Cancellation

The operation creates and publishes its `AbortController`, sets pending UI state, and starts the timeout before its first asynchronous filesystem operation. After directory creation it checks the signal before invoking the provider. Therefore an immediate `cancelLogin` request prevents the CLI login from starting even when directory setup is still pending.

### Reversible state

Before a destructive mutation, the operation captures only the state needed to undo it:

- the previous metadata state,
- the previous managed credential when an existing account is replaced,
- the exact current real-home `auth.json` content, including the distinction between a missing file and an empty object.

The provider exposes explicit read/write operations for managed and current auth content. Every provider-owned access to the real-home `auth.json` uses the same real-home credential lock. Operations that touch both a managed home and the real home acquire both locks through the shared sorted multi-lock helper, so lock order is deterministic. Writes remain atomic and mode `0600`; missing current auth is restored by removing the file. Secrets remain plugin-main-private and must never be logged or included in error messages.

Compensations are registered before their corresponding mutation and execute in reverse order. Metadata rollback includes a flush. Managed-credential restoration and real-home restoration are independent compensations. Real-home restoration is compare-and-set under one real-home lock: it restores only when current content still matches the newly materialized auth, no-ops when the previous content is already present, and otherwise reports a generic conflict without overwriting a concurrent update or exposing auth content.

### Error handling

All rollback and cleanup steps are best-effort but exhaustive: one cleanup failure never prevents later cleanup or login-error classification. The original classified login failure is the primary error. Any rollback or cleanup failures are appended to an `AggregateError`. UI pending state, mode, abort reference, and final snapshot are reset in `finally`.

A successful operation clears compensations and retains the new account credential. Duplicate-account temporary homes are removed after their credential has been transferred. Failed operations remove temporary credentials and directories without deleting restored existing credentials.

## 2. Atomic OMP credential selection

Both plugin-specific OMP sync implementations wrap the complete selection mutation in a SQLite `BEGIN IMMEDIATE` transaction. Grok applies this boundary to both OIDC and API-key OMP selection:

1. locate the target identity,
2. update or insert the target credential,
3. disable every other currently enabled row for that provider,
4. commit.

Any failure rolls back the whole mutation. Grok API-key selection disables only other enabled `provider='xai'` / `credential_type='api_key'` rows; `xai-oauth` rows remain a separate provider identity and are not disabled. A rollback failure is combined with the original database failure in an `AggregateError`. Database close remains unconditional. Each plugin keeps its small transaction helper locally to preserve plugin isolation.

Real SQLite tests use a trigger that fails the disable statement and assert that neither a target insert/update nor old-row disable survives.

## 3. Grok usage compatibility and fallback

A single valid `productUsage` item is hidden only when a period-total window was successfully produced. Without a usable total, the product window is retained as the only quota signal.

The credits endpoint remains primary. Non-abort transport failures become an error result local to that endpoint, allowing the default endpoint to run. Caller cancellation and combined timeout signals terminate immediately and do not issue fallback network requests. Authentication failures still terminate with re-login guidance. Plain 403 responses remain ordinary request errors; messages containing the established authentication markers remain authentication failures.

Tests cover single-product/no-total parsing, credits transport fallback, abort/timeout no-fallback behavior, plain 403, and authentication-shaped 403.

## 4. Managed plugin watcher ownership

Development runtime watchers are owned by a registry keyed by plugin ID. The registry:

- starts at most one watcher per plugin,
- has no plugin-specific branches,
- stores every returned handle,
- disposes every handle exactly once,
- clears itself after disposal.

`app-core` uses this registry while retaining its existing public shutdown method. Unit tests inject fake watcher handles and validate multi-plugin creation, deduplication, and disposal.

## 5. Bundled registration verification

The bundled official plugin collector remains data-driven. Its reader dependency is injectable for unit tests without changing production callers. Tests verify:

- complete registration mapping,
- optional metadata omission/preservation,
- unavailable bundles in `availableById`,
- stable ordering for available registrations.

## 6. Test and validation strategy

Every behavioral fix follows red-green-refactor:

1. add a focused regression test,
2. run it and confirm the expected failure,
3. implement the smallest production change,
4. rerun the focused test to green,
5. run the affected test group after refactoring.

Required final validation for the changed scope:

- focused Grok account/provider tests,
- Codex and Grok cross-tool sync tests,
- Grok billing and usage tests,
- managed plugin watcher and bundled registration tests,
- `pnpm typecheck`,
- Biome/Ultracite on changed files,
- `pnpm depcruise`,
- `git diff --check HEAD`,
- full unit tests, with unrelated baseline failures reported separately rather than silently attributed to this change.

No commit, branch, rebase, reset, or push is created as part of this work.
