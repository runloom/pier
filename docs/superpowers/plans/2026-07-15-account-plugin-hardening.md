# Account Plugin Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Codex/Grok account-plugin changes transactionally consistent, failure-tolerant, lifecycle-safe, and fully regression-tested.

**Architecture:** Grok OIDC account creation uses a reverse-order compensation stack over explicit provider auth read/write primitives. OMP mutations use real SQLite immediate transactions. Usage requests isolate endpoint-local transport failures, while managed plugin development watchers are owned by an ID-keyed registry.

**Tech Stack:** TypeScript 6 strict, Node 24, Electron main process, `node:sqlite`, Vitest 4, Biome/Ultracite.

## Global Constraints

- Do not log, serialize into errors, or expose auth content outside plugin main code.
- Credential files must use atomic writes and mode `0o600`.
- Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Preserve plugin isolation; Codex and Grok must not import from each other.
- Use one writer in the active dirty worktree.
- Do not create commits, branches, rebases, resets, or pushes.
- Every production behavior change must first have a focused failing test.

---

### Task 1: Grok usage schema and endpoint resilience

**Files:**
- Modify: `tests/unit/main/grok-plugin-billing-parse.test.ts`
- Modify: `tests/unit/main/grok-plugin-usage-fetch.test.ts`
- Modify: `packages/plugin-grok/src/main/billing-parse.ts`
- Modify: `packages/plugin-grok/src/main/grok-usage.ts`

**Interfaces:**
- Consumes: `parseGrokBillingResult(payload: unknown): AccountUsageResult`
- Produces: endpoint-local non-abort transport errors and single-product quota preservation.

- [ ] **Step 1: Add the single-product regression test**

```ts
it("keeps a single product window when no period total is present", () => {
  expect(
    parseGrokBillingResult({
      config: { productUsage: [{ product: "Api", usagePercent: 73 }] },
    })
  ).toMatchObject({
    status: "ok",
    windows: [{ id: "grok:product:Api", usedPercent: 73 }],
  });
});
```

- [ ] **Step 2: Add fetch fallback and 403 tests**

Add focused tests asserting:

```ts
it("falls back to default billing after a credits transport failure", async () => {
  const fetchImpl = vi.fn(async (url: string) => {
    if (url === GROK_BILLING_CREDITS_URL) throw new Error("credits unavailable");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ config: { monthlyLimit: 100, used: 25 } }),
    };
  });
  const result = await fetchGrokUsage({ authJson: AUTH, fetchImpl, kind: "oidc", signal: new AbortController().signal });
  expect(result).toMatchObject({ status: "ok" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
```

Also add one plain-403 case that does not contain re-login guidance, one `permissionDenied` 403 case that does, and one aborted transport case that performs no fallback.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/main/grok-plugin-billing-parse.test.ts tests/unit/main/grok-plugin-usage-fetch.test.ts
```

Expected: the single-product and transport-fallback tests fail for the reviewed regressions.

- [ ] **Step 4: Preserve a valid single product only when needed**

Compute whether a period window exists before iterating products:

```ts
const hasPeriodWindow = windows.some((window) => window.id === "grok:period");
const shouldIncludeProducts =
  Array.isArray(productUsage) &&
  (productUsage.length > 1 || !hasPeriodWindow);
```

Iterate products only when `shouldIncludeProducts` is true.

- [ ] **Step 5: Convert endpoint-local transport failures into results**

Wrap the request body so a non-abort exception returns `{ status: "error", error, windows: [] }`, but rethrows when the combined request signal is aborted. This lets the existing credits-first decision reach the default endpoint without retrying cancellation or timeout.

- [ ] **Step 6: Run focused tests to GREEN**

Run the command from Step 3. Expected: all tests pass.

---

### Task 2: Atomic Codex and Grok OMP switches

**Files:**
- Modify: `tests/unit/main/codex-cross-tool-sync.test.ts`
- Modify: `tests/unit/main/grok-plugin-cross-tool-sync.test.ts`
- Modify: `packages/plugin-codex/src/main/cross-tool-sync.ts`
- Modify: `packages/plugin-grok/src/main/cross-tool-sync.ts`

**Interfaces:**
- Consumes: each plugin's private `DatabaseSyncLike`.
- Produces: all-or-nothing target activation and old-row disabling.

- [ ] **Step 1: Add real SQLite rollback tests**

For each plugin, seed an enabled old row and install a trigger before calling sync:

```sql
CREATE TRIGGER fail_disable
BEFORE UPDATE OF disabled_cause ON auth_credentials
WHEN NEW.disabled_cause IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'disable failed');
END;
```

Assert the per-target result is `{ ok: false, target: "omp" }`, the old row remains enabled, and no new identity row exists.

- [ ] **Step 2: Run both tests and confirm RED**

```bash
pnpm exec vitest run tests/unit/main/codex-cross-tool-sync.test.ts tests/unit/main/grok-plugin-cross-tool-sync.test.ts
```

Expected: the failure result is returned, but the new row remains, proving partial commit.

- [ ] **Step 3: Add local immediate-transaction helpers**

Extend each `DatabaseSyncLike` with `exec(sql: string): void` and add a helper with these semantics:

```ts
function runImmediateTransaction<T>(db: DatabaseSyncLike, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "OMP credential update and rollback failed");
    }
    throw error;
  }
}
```

Wrap lookup, insert/update, and disable statements in this helper in each plugin.

- [ ] **Step 4: Run both tests to GREEN**

Run the command from Step 2. Expected: success and rollback tests pass.

---

### Task 3: Provider auth snapshot and restoration primitives

**Files:**
- Modify: `tests/unit/main/grok-plugin-provider.test.ts`
- Modify: `packages/plugin-grok/src/main/grok-provider.ts`
- Modify: `tests/unit/main/grok-plugin-accounts-service.test.ts` provider fake.

**Interfaces:**
- Produces on `GrokAccountProvider`:
  - `readCurrentAuthContent(): Promise<string | null>`
  - `writeCurrentAuthContent(content: string | null): Promise<void>`
  - `writeManagedAuthContent(accountHomeDir: string, content: string): Promise<void>`

- [ ] **Step 1: Add provider round-trip tests**

Test that managed content can be replaced and read back, current auth content can be read and atomically replaced, and `writeCurrentAuthContent(null)` removes the real auth file.

- [ ] **Step 2: Run provider tests and confirm RED**

```bash
pnpm exec vitest run tests/unit/main/grok-plugin-provider.test.ts
```

Expected: TypeScript/runtime failure because the three methods do not exist.

- [ ] **Step 3: Implement secure provider primitives**

Use the existing credential locks and key derivation:

```ts
async writeManagedAuthContent(accountHomeDir, content) {
  await withCredentialLock(accountHomeDir, async () => {
    await credentials.set(credentialKey(accountHomeDir), content);
    await rm(join(accountHomeDir, "auth.json"), { force: true });
  });
}
```

For current auth, read with `ENOENT -> null`; write non-null content using `writeFileAtomic(..., { mode: 0o600 })`; remove the file for null. Never log content.

- [ ] **Step 4: Update typed provider fakes**

Add inert implementations for the new methods to `createProvider()` in the account-service tests and any other compiler-reported `GrokAccountProvider` fakes.

- [ ] **Step 5: Run provider tests to GREEN**

Run the command from Step 2 and `pnpm typecheck:packages`.

---

### Task 4: Transactional Grok OIDC account addition

**Files:**
- Create: `tests/unit/main/grok-plugin-accounts-add-oidc.test.ts`
- Modify: `packages/plugin-grok/src/main/accounts-add-oidc.ts`
- Modify: `packages/plugin-grok/src/main/accounts-service.ts`

**Interfaces:**
- Consumes: the provider primitives from Task 3.
- Produces: immediate cancellation, reverse-order compensation, exhaustive cleanup, and stable error classification.

- [ ] **Step 1: Add cancellation-before-directory-completion test**

Use a deferred `ensureManagedDir`. Start `addOidcAccount`, capture the published controller, abort it before resolving the directory, then assert `provider.login` is never called and the operation rejects as cancellation.

- [ ] **Step 2: Add cleanup aggregation test**

Make login throw `login failed` and `deleteCredential` throw `cleanup failed`. Assert directory cleanup still occurs, `lastLoginError` reflects the login failure, UI state is reset, and the rejection is an `AggregateError` containing both errors.

- [ ] **Step 3: Add new-account flush rollback test**

Use a state store whose first post-mutation flush fails and whose rollback flush succeeds. Assert metadata returns to the exact previous object, the temporary credential is deleted, and the exact previous current auth content is restored.

- [ ] **Step 4: Add duplicate-account restoration test**

Seed an active existing account with old managed auth. Make replacement succeed and metadata flush fail. Assert `writeManagedAuthContent(existingDir, oldAuth)` and restoration of the previous current auth both occur.

- [ ] **Step 5: Run the new test and confirm RED**

```bash
pnpm exec vitest run tests/unit/main/grok-plugin-accounts-add-oidc.test.ts
```

Expected: cancellation timing, cleanup aggregation, and restoration assertions fail.

- [ ] **Step 6: Implement a reverse-order compensation stack**

Keep an array of named async compensations. Register compensation before mutation, run all entries in reverse on failure, collect every error, and clear the stack only after successful metadata flush. Classify the original error before running cleanup so cleanup failures cannot hide the user-facing cause.

The operation order is:

1. publish abort/pending state and start timeout,
2. capture current auth,
3. create managed directory and check abort,
4. login/read identity,
5. capture existing managed auth when replacing,
6. register metadata, managed-auth, and current-auth compensations before their mutations,
7. mutate/materialize/flush,
8. commit by clearing compensations,
9. run success-only usage refresh.

Always attempt temporary credential deletion and directory removal on failure. Do not delete an existing account directory.

- [ ] **Step 7: Run account tests to GREEN**

```bash
pnpm exec vitest run tests/unit/main/grok-plugin-accounts-add-oidc.test.ts tests/unit/main/grok-plugin-accounts-service.test.ts tests/unit/main/grok-plugin-provider.test.ts
```

Expected: all tests pass without unhandled rejections.

---

### Task 5: Generic managed-plugin watcher registry

**Files:**
- Modify: `tests/unit/main/managed-plugin-dev-runtime-watch.test.ts`
- Modify: `src/main/app-core/managed-plugin-dev-runtime-watch.ts`
- Modify: `src/main/app-core/app-core.ts`

**Interfaces:**
- Produces: `createManagedPluginDevRuntimeWatchRegistry(start?)` with `ensure(pluginId, options)` and `dispose()`.

- [ ] **Step 1: Add registry lifecycle test**

Inject a fake start function that returns per-plugin dispose spies. Ensure Codex twice and Grok once; assert start is called twice, then `dispose()` closes both handles exactly once and a second dispose is harmless.

- [ ] **Step 2: Run test and confirm RED**

```bash
pnpm exec vitest run tests/unit/main/managed-plugin-dev-runtime-watch.test.ts
```

Expected: import/function missing.

- [ ] **Step 3: Implement the registry**

Use a private `Map<string, ManagedPluginDevRuntimeWatch>`. `ensure` returns early for an existing ID; `dispose` iterates all handles in a `try/finally` structure that still attempts every handle and clears the map, aggregating multiple disposal failures if necessary.

- [ ] **Step 4: Replace app-core's singular watcher**

Construct one registry, call `ensure(spec.id, ...)` for every active available spec, remove the `spec.id === "pier.codex"` branch, and delegate the existing public `disposeManagedPluginDevRuntimeWatch()` method to registry disposal.

- [ ] **Step 5: Run watcher test and host typecheck to GREEN**

```bash
pnpm exec vitest run tests/unit/main/managed-plugin-dev-runtime-watch.test.ts
pnpm typecheck:host
```

---

### Task 6: Bundled official plugin collector tests

**Files:**
- Create: `tests/unit/main/bundled-official-plugins.test.ts`
- Modify: `src/main/app-core/bundled-official-plugins.ts`

**Interfaces:**
- Produces: optional `readBundle` dependency on `collectBundledPluginRegistrations`, defaulting to `readBundledPlugin`.

- [ ] **Step 1: Add collector tests**

Use two specs and a fake reader. Assert stable spec order, registration mapping including locales/description/size, omission of absent optional fields, and `availableById` values for one present and one missing bundle.

- [ ] **Step 2: Run test and confirm RED**

```bash
pnpm exec vitest run tests/unit/main/bundled-official-plugins.test.ts
```

Expected: collector cannot accept the fake reader.

- [ ] **Step 3: Inject the reader dependency**

Use a trailing defaulted parameter:

```ts
export function collectBundledPluginRegistrations(
  specs = OFFICIAL_BUNDLED_PLUGIN_SPECS,
  readBundle: typeof readBundledPlugin = readBundledPlugin
) { /* existing loop using readBundle */ }
```

- [ ] **Step 4: Run test to GREEN**

Run the command from Step 2.

---

### Task 7: Formatting, regression suite, and final review

**Files:**
- Format every changed source/test file.
- Keep `docs/superpowers/specs/2026-07-15-account-plugin-hardening-design.md` and this plan unless the user requests removal.

- [ ] **Step 1: Run focused regression tests**

```bash
pnpm exec vitest run \
  tests/unit/main/grok-plugin-accounts-add-oidc.test.ts \
  tests/unit/main/grok-plugin-accounts-service.test.ts \
  tests/unit/main/grok-plugin-provider.test.ts \
  tests/unit/main/grok-plugin-billing-parse.test.ts \
  tests/unit/main/grok-plugin-usage-fetch.test.ts \
  tests/unit/main/grok-plugin-cross-tool-sync.test.ts \
  tests/unit/main/codex-cross-tool-sync.test.ts \
  tests/unit/main/managed-plugin-dev-runtime-watch.test.ts \
  tests/unit/main/bundled-official-plugins.test.ts
```

Expected: all pass.

- [ ] **Step 2: Apply repository formatting to changed files**

Run `pnpm exec biome check --write` with the explicit changed-file list. Do not format unrelated files.

- [ ] **Step 3: Run static validation**

```bash
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm check:file-size
git diff --check HEAD
```

Expected for changed scope: typecheck, lint, dependency boundaries, and diff whitespace pass. If whole-repository lint or file-size checks fail only on unchanged baseline files, record exact paths and do not alter unrelated code.

- [ ] **Step 4: Run full tests**

```bash
pnpm test:unit
pnpm test:component
pnpm test:integration
```

Record exact pass/fail counts. Keep the unsigned official-index baseline failure separate if it remains unchanged.

- [ ] **Step 5: Inspect final diff and request independent review**

Review `git diff HEAD`, confirm no secret literals or unrelated changes, then dispatch fresh read-only reviewers for correctness/rollback, tests, and maintainability. Apply only evidence-backed findings through the same test-first process.
