# Managed External Plugins and Codex Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build managed trusted external plugins and migrate Codex account management from Pier core into the official `pier.codex` external plugin.

**Architecture:** Pier owns installation state under `userData/plugins`, installs immutable plugin versions, and loads enabled active versions at startup. External plugins have main and renderer entries; renderer-to-main private communication uses plugin-scoped RPC/events through host IPC. Codex becomes the bundled seed external plugin and owns all Codex account storage, login, usage polling, commands, and dashboard UI.

**Tech Stack:** Electron 42, React 19, TypeScript 6 strict, electron-vite 5, Vite 8, Zod 4, Zustand 5, Vitest 4, Playwright, pnpm workspace packages.

## Global Constraints

- v1 external plugins are trusted code, not a security sandbox. There is no per-plugin principal in v1; manifest permissions are declaration, UI, and governance-test discipline, not a malicious-code authorization boundary.
- Official plugin packages are GitHub Release `.tgz` assets referenced by the signed central official index `https://pier.earendil.works/plugins/index.v1.json`. The app pins official index public keys by `keyId` and rejects unsigned indexes, unknown keys, sequence rollback, same-version hash drift, non-allowlisted GitHub Release asset URLs, and redirects outside the allowlist.
- Signing infrastructure (Ed25519 key generation and safekeeping, index build/publish pipeline for `https://pier.earendil.works/plugins/index.v1.json`, key rotation) is a **prerequisite delivered outside this plan**. The plan consumes only the pinned public keys hardcoded in the app. Task 2 onward must have at least one usable official `keyId` + public key and a live signed index endpoint (or a stand-in reachable in dev/test); until then, Tasks 3-11 run against **mocked signed indexes**, never against unsigned indexes with an "add signing later" TODO. v1 has no remote revocation; every signature is a long-term commitment.
- `MANAGED_PLUGIN_PACKAGE_LIMITS` defaults apply to every official archive extraction, bundled seed package validation, rollback candidate validation, and dev override directory validation; no install path may run unbounded archive or directory traversal.
- Managed plugin command authorization is client-kind based: `plugin.catalog.list` may be read by `desktop-renderer` and `cli-local`; check/update/install/rollback/uninstall/enable/disable/devOverride commands are `desktop-renderer` only in v1.
- `PIER_OFFICIAL_PLUGIN_INDEX_URL` is honored only in dev/test runtime; production ignores it and records diagnostics.
- No automatic plugin updates; users manually click Update.
- Updated plugin versions and external plugin enable/disable/uninstall/dev override changes require restarting Pier; keep desired next-start state separate from the effective runtime snapshot loaded at process start.
- Activation failure never switches plugin code versions inside the current process. Rollback and last-known-good recovery only change next-start desired state, so main and renderer code from different versions are not mixed in one session.
- `pier.codex` is installed and enabled by default from a bundled seed on first startup.
- Dev plugin override takes precedence over installed active versions on the next app start only in dev/test runtime and is for local trusted development. Production packaged builds must hide dev override UI entry points, reject `plugin.devOverride.*` commands, and ignore any already-persisted `devOverride` during boot without reading the local path; future production developer mode would require a separate design.
- v1 dev override supports local prebuilt package directories only (`package.json` with `"type": "module"`, `plugin.json`, `dist/main.js`, and `dist/renderer.js`); HTTP dev-server overrides are out of scope.
- Plugin code under `installed/<id>/<version>` is immutable.
- Installation uses staging validation and temp-sibling atomic rename before index mutation, including safe `.tgz` member validation before extraction writes outside staging are possible.
- Every install/update/rollback/uninstall/enable/disable/dev override operation writes a minimal append-only operation log record with timestamp, operation, actor kind, plugin id, old/new versions, official index sequence, asset URL, sha256, signing key id, result, and diagnostic id when present.
- Plugin-scoped `context.secrets` is encrypted-only and fail-closed. It must not use plaintext fallback for plugin secrets; Codex auth writes are rejected when safeStorage encryption is unavailable.
- Plugin work data schema compatibility is a host-readable manifest contract: plugin packages declare `dataSchemas`, and plugins write `work/<id>/.pier-plugin-data-schemas.json`; install-service must not import plugin private source to decide rollback compatibility.
- Remove host Codex account APIs: `agent-accounts`, `window.pier.accounts`, `RendererPluginContext.accounts`, `account:*`, and `accounts.*` commands.
- Public plugin renderer code receives only a scoped `context.rpc.invoke(method, payload)` API; arbitrary `pluginId` RPC invoke is not part of `@pier/plugin-api`.
- Managed plugin paths must be resolved after `configureAppIdentity()` has set the final Electron `userData` path.
- Do not add marketplace search, arbitrary registry install, isolation sandboxing, or a generic provider/account platform.
- Do not use `@ts-ignore`, `@ts-expect-error`, or `as any`.

---

## File Structure

### Shared contracts

- Create `src/shared/contracts/managed-plugin.ts`: package manifest, install index, official index, operation result, runtime diagnostics schemas.
- Create `src/shared/contracts/plugin-rpc.ts`: RPC invoke request/result and event payload schemas.
- Modify `src/shared/contracts/plugin.ts`: add effective `official` source and runtime kind `external` with optional `rendererEntryUrl`.
- Create `src/shared/contracts/plugin-commands.ts`: managed plugin command schemas imported by the main command contract to avoid growing `commands.ts` further.
- Modify `src/shared/contracts/commands.ts`: add managed plugin commands; do not add plugin RPC to the public PierCommand union.
- Modify `src/shared/contracts/permissions.ts` and `src/main/app-core/permissions.ts`: add plugin management permissions/metadata only; `account:*` removal is deferred to Task 11 with the rest of the host account API removal.
- Modify `src/shared/ipc-channels.ts`: add plugin RPC broadcast channel and a renderer-only invoke channel for plugin RPC.

### Main process

- Create `src/main/services/managed-plugins/paths.ts`: `userData/plugins` path helpers.
- Create `src/main/services/managed-plugins/index-state.ts`: persistent `index.json` store.
- Create `src/main/services/managed-plugins/version.ts`: semver-backed version sorting and Pier engine range checks.
- Create `src/main/services/managed-plugins/package-validation.ts`: package ESM marker, manifest, entry, hash, size, safe archive member, path-safety validation, and renderer/main import-specifier scans.
- Create `src/main/services/managed-plugins/official-index.ts`: central index fetch/cache, override URL support, and latest compatible version selection.
- Create `src/main/services/managed-plugins/operation-log.ts`: append-only security-relevant plugin operation log.
- Create `src/main/services/managed-plugins/install-service.ts`: seed install, install, update, rollback, uninstall, enable, disable, dev override, boot-time runtime source snapshots, activation-result tracking, and `plugin-state.json` migration.
- Create `src/main/plugins/plugin-rpc-bus.ts`: plugin-scoped handlers, invoke dispatch, event broadcast.
- Create `src/main/plugins/plugin-asset-protocol.ts`: `pier-plugin://` scheme registration/handler for installed plugin renderer entries/assets.
- Create `src/main/plugins/external-main-runtime.ts`: dynamic import of external main plugins and lifecycle cleanup.
- Modify `src/main/services/plugin-sources.ts`, `src/main/services/plugin-service.ts`, `src/main/plugins/runtime.ts`, `src/main/plugins/plugin-context.ts`, `src/main/csp.ts`, `src/main/index.ts`, and app-core wiring to compose builtin and external plugins after userData is finalized.

### Renderer and preload

- Create `src/preload/plugin-management-api.ts`: plugin management preload facade, imported by `src/preload/index.ts` to avoid growing preload past file-size limits.
- Create `src/preload/plugin-rpc-api.ts`: host-internal renderer-only plugin RPC bridge, imported by `src/preload/index.ts` without exposing arbitrary pluginId RPC in public plugin API.
- Create `src/renderer/lib/plugins/external-renderer-loader.ts`: dynamic import for external renderer entries and plugin panel unavailable fallback handling.
- Create `src/renderer/lib/plugins/plugin-shared-runtime.ts`: expose React/UI singleton bridge for external renderer bundles.
- Create `src/renderer/lib/plugins/external-plugin-context.ts`: builds account-free external renderer contexts with `context.rpc`.
- Modify `src/renderer/lib/plugins/runtime.ts` and `bootstrap.ts`: activate external renderer modules using the new external context helper. Leave legacy `host-context.ts` account behavior intact until Task 11b.
- Create `src/renderer/pages/settings/components/managed-plugins-section.tsx`: installed/available/update/dev override management UI.
- Create `src/renderer/pages/settings/components/managed-plugin-card.tsx`: per-plugin card actions and trust warning UI.
- Modify `src/renderer/pages/settings/components/plugins-section.tsx`: compose the new managed plugin components without growing this file.

### Plugin packages

- Create `packages/plugin-api/`: public external plugin API plus React classic/automatic JSX runtime shims and build-preset helpers that prevent bare browser-unresolvable imports.
- Create `packages/plugin-codex/`: official Codex plugin main service, renderer widget, manifest, build config, and package script.
- Use `packages/plugin-codex/dist-package/` as the generated Codex seed package; do not copy built plugin output into tracked `resources/plugins`.
- Modify `scripts/build-dist.sh` and `electron-builder.yml` so packaged apps always include a fresh built Codex seed package from `packages/plugin-codex/dist-package` as app resource target `plugins/pier.codex`.

### Deletions after migration

- Delete `src/main/services/agent-accounts/`.
- Delete `src/main/state/agent-accounts-state.ts`.
- Delete `src/renderer/stores/agent-accounts.store.ts`.
- Delete `src/renderer/lib/plugins/host-accounts-context.ts`.
- Remove `window.pier.accounts` from preload.
- Remove `RendererPluginContext.accounts` from `src/plugins/api/renderer.ts`; `packages/plugin-api/src/renderer.ts` must never expose `accounts`.

---

### Task 0: Architecture guardrail preflight

**Files:**
- Modify: `AGENTS.md`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `scripts/check-file-size.sh`
- Test: `tests/unit/plugins/plugin-api-boundary.test.ts`

**Interfaces:**
- Documents that v1 allows only builtin plugins plus official managed external plugins, and that both are trusted-code discipline boundaries rather than security sandboxes.
- Adds early guardrails before `packages/plugin-api` / `packages/plugin-codex` grow: package sources must not import app internals, and app `src/**` must not statically import external plugin implementation sources.

- [ ] **Step 1: Update the project architecture context**

Update `AGENTS.md` before implementation begins. Replace the old “only builtin plugins” wording with “builtin plugins plus official managed external plugins only,” and explicitly state that third-party plugins still require a separate isolation design: independent realm/process, per-plugin principal, main-side plugin-subject authorization, and supply-chain signing.

Mark the account-domain section as a migration: before Task 11 the host `agent-accounts` service still exists; after Task 11 Codex account state is a `pier.codex` private plugin domain.

- [ ] **Step 2: Add early boundary tests**

Create minimal package-boundary tests now, even before the packages exist. They should pass when packages are absent and become active once paths exist:

```ts
expect(scanImports("packages/plugin-api/src", { allowMissing: true })).not.toContainImportMatching(/src\/main|src\/renderer|plugins\/builtin/);
expect(scanImports("packages/plugin-codex/src", { allowMissing: true })).not.toContainImportMatching(/^src\/|src\/main|src\/renderer/);
expect(scanImports("src")).not.toContainImportMatching(/packages\/plugin-codex\/src|@pier\/plugin-codex\/src/);
```

Extend `scripts/check-file-size.sh` to include `packages/*/src`, excluding `dist`, `dist-package`, and generated output. Add depcruise rules in a permissive “path may not exist yet” form if needed; Task 12 can tighten the final rule set.

- [ ] **Step 3: Run preflight verification**

Run:

```bash
pnpm vitest run tests/unit/plugins/plugin-api-boundary.test.ts
pnpm depcruise
pnpm check:file-size
```

Expected: PASS.

---

### Task 1: Managed plugin shared contracts

**Files:**
- Create: `src/shared/contracts/managed-plugin.ts`
- Create: `src/shared/contracts/plugin-rpc.ts`
- Create: `src/shared/contracts/plugin-commands.ts`
- Modify: `src/shared/contracts/plugin.ts`
- Modify: `src/shared/contracts/commands.ts`
- Modify: `src/shared/contracts/permissions.ts`
- Modify: `src/main/app-core/permissions.ts`
- Modify: `src/shared/ipc-channels.ts`
- Test: `tests/unit/shared/managed-plugin-contracts.test.ts`

**Interfaces:**
- Produces `managedPluginPackageManifestSchema`, `managedPluginInstallIndexSchema`, `officialPluginIndexSchema`.
- Produces `pluginRpcInvokeRequestSchema`, `pluginRpcInvokeResultSchema`, `pluginRpcEventPayloadSchema`.
- Produces PierCommand variants `plugin.catalog.list`, `plugin.checkUpdates`, `plugin.install`, `plugin.update`, `plugin.rollback`, `plugin.uninstall`, `plugin.enable`, `plugin.disable`, `plugin.devOverride.set`, `plugin.devOverride.clear`, and `app.relaunch` (used by the settings UI's Restart Pier Now button). Existing `plugin.list` remains the runtime registry list returning `PluginRegistryListResult`.
- Produces renderer-only IPC channel constants/types for plugin RPC invoke; plugin RPC must not be accepted through CLI/local-control PierCommand routing.
- Produces a client-kind authorization matrix: `plugin.catalog.list` is read-only and may be allowed for `desktop-renderer` and `cli-local`; `plugin.checkUpdates`, `plugin.install`, `plugin.update`, `plugin.rollback`, `plugin.uninstall`, `plugin.enable`, `plugin.disable`, `plugin.devOverride.set`, `plugin.devOverride.clear`, and `app.relaunch` are desktop-renderer-only in v1. `cli-local` remains read-only for managed plugins and cannot relaunch the app.
- Keeps existing `accounts.*` commands and `account:*` capabilities until Task 11b removes the host account API. Task 11a introduces the Codex plugin as authoritative for account state; Task 11b then deletes the now-unused host surface with `pnpm typecheck` staying green throughout.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/managed-plugin-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { managedPluginCatalogSnapshotSchema, managedPluginInstallIndexSchema, managedPluginPackageManifestSchema, officialPluginIndexSchema } from "@shared/contracts/managed-plugin.ts";
import { pluginRpcEventPayloadSchema, pluginRpcInvokeRequestSchema } from "@shared/contracts/plugin-rpc.ts";

const manifest = {
  apiVersion: 1,
  commands: [{ id: "pier.codex.addAccount", title: "Codex: Add Account" }],
  dashboardWidgets: [],
  engines: { pier: ">=0.1.0 <0.2.0" },
  id: "pier.codex",
  main: "dist/main.js",
  name: "Codex",
  panels: [],
  permissions: ["plugin:read"],
  renderer: "dist/renderer.js",
  terminalStatusItems: [],
  version: "1.0.0",
};

describe("managed plugin contracts", () => {
  it("accepts a package manifest without source metadata", () => {
    expect(managedPluginPackageManifestSchema.parse(manifest)).toMatchObject({ id: "pier.codex" });
  });

  it("rejects absolute package entry paths", () => {
    expect(() => managedPluginPackageManifestSchema.parse({ ...manifest, main: "/tmp/main.js" })).toThrow();
  });

  it("accepts install index records", () => {
    expect(managedPluginInstallIndexSchema.parse({
      version: 1,
      plugins: {
        "pier.codex": {
          activeVersion: "1.0.0",
          devOverride: null,
          enabled: true,
          id: "pier.codex",
          installedVersions: { "1.0.0": { installedAt: 1, packageUrl: "bundled://pier.codex/1.0.0", sha256: "abc" } },
          pendingUpdate: null,
          pendingRestart: null,
          effectiveAtStartup: { version: "1.0.0", enabled: true, sourceKind: "official" },
          source: { kind: "official", seededFromBundle: true },
        },
      },
    })).toMatchObject({ plugins: { "pier.codex": { enabled: true } } });
  });

  it("accepts uninstall tombstone records", () => {
    expect(managedPluginInstallIndexSchema.parse({
      version: 1,
      plugins: {
        "pier.codex": {
          activeVersion: null,
          devOverride: null,
          enabled: false,
          id: "pier.codex",
          installedVersions: {},
          pendingUpdate: null,
          pendingRestart: { kind: "uninstall" },
          effectiveAtStartup: { version: "1.0.0", enabled: true, sourceKind: "official" },
          source: { kind: "official", seededFromBundle: true },
          uninstalledAt: 123,
        },
      },
    }).plugins["pier.codex"].activeVersion).toBeNull();
  });

  it("accepts managed catalog snapshots for settings UI", () => {
    expect(managedPluginCatalogSnapshotSchema.parse({
      checkedAt: 123,
      plugins: [
        { id: "pier.codex", displayName: "Codex", installed: true, desired: { enabled: false, version: "1.1.0", source: "official" }, effective: { enabled: true, version: "1.0.0", source: "official" }, lastKnownGoodVersion: "1.0.0", pendingRestart: { kind: "update", version: "1.1.0" }, update: null, diagnostics: [] },
        { id: "pier.other", displayName: "Other", installed: false, desired: { enabled: false, version: null, source: "official" }, effective: null, lastKnownGoodVersion: null, pendingRestart: null, update: { version: "1.0.0" }, diagnostics: [] },
      ],
    }).plugins).toHaveLength(2);
  });

  it("accepts signed official index entries", () => {
    expect(officialPluginIndexSchema.parse({
      generatedAt: 1783449600000,
      version: 1,
      sequence: 42,
      plugins: {
        "pier.codex": {
          description: "Codex account management",
          displayName: "Codex",
          id: "pier.codex",
          latest: "1.1.0",
          versions: { "1.1.0": { assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.1.0/pier-codex-1.1.0.tgz", pier: ">=0.1.0 <0.2.0", sha256: "def", size: 100 } },
        },
      },
      signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "base64-signature" },
    })).toMatchObject({ plugins: { "pier.codex": { latest: "1.1.0" } } });
  });

  it("accepts plugin RPC messages", () => {
    expect(pluginRpcInvokeRequestSchema.parse({ pluginId: "pier.codex", method: "accounts.snapshot", payload: null })).toMatchObject({ method: "accounts.snapshot" });
    expect(pluginRpcEventPayloadSchema.parse({ pluginId: "pier.codex", event: "accounts.changed", payload: { accounts: [] } })).toMatchObject({ event: "accounts.changed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/shared/managed-plugin-contracts.test.ts`

Expected: FAIL because `managed-plugin.ts` and `plugin-rpc.ts` do not exist.

- [ ] **Step 3: Implement schemas and command variants**

Add Zod schemas in `managed-plugin.ts` and `plugin-rpc.ts`. Use relative-entry refinements that allow normal POSIX relative paths with `/` such as `dist/main.js`, but reject absolute paths, drive-letter/UNC-looking paths, and any `..` path segment. Add optional manifest `dataSchemas: Record<string, { read: string; write: number }>` where `read` is a semver-style integer range such as `>=1 <=2` and `write` is the persisted schema version this package writes. Rollback compatibility only consults `read`: the candidate version's manifest `dataSchemas.<name>.read` must cover the marker's current schema version, or the candidate is rejected. `write` drives first-run upgrade decisions inside the plugin. Do not introduce a third `current` field: the previously proposed "typically equals `write`" wording is drift-prone documentation, not a semantic distinction, and adds nothing beyond `read` + `write`. install-service uses this generic manifest field plus `work/<id>/.pier-plugin-data-schemas.json`, not plugin private code, to decide rollback compatibility. If a work-data marker contains a schema absent from the target manifest, compatibility fails closed; if the marker file is absent, treat it as no host-known constraint. The generic install service must not scan plugin-private files such as `accounts.json` to infer schema ownership. Malformed markers fail closed. Add `official` to `pluginSourceKindSchema`, `external` to runtime kind, and `rendererEntryUrl?: string` on runtime metadata. Model uninstall tombstones and restart-pending state explicitly: `activeVersion` is nullable, `lastKnownGoodVersion?: string | null` records the last version whose main activation, renderer activation, package hash verification, and plugin data schema compatibility all succeeded, `installedVersions` may be empty, `uninstalledAt?: number` suppresses bundled seed reinstall while preserving work data, `pendingRestart?: { kind: "install" | "update" | "enable" | "disable" | "uninstall" | "devOverride" | "rollback"; version?: string }`, and `effectiveAtStartup` stores the actually loaded version/enabled/source for the current process. Catalog rows must always expose `lastKnownGoodVersion: string | null`; it is not optional. In catalog snapshots, `update` means an available newer official version from the signed index, while `pendingRestart.kind === "update"` means an update has already changed desired state and is waiting for restart. Add `managedPluginCatalogSnapshotSchema` for settings UI rows that expose separate `desired`, `effective`, `lastKnownGoodVersion`, and `pendingRestart` fields by combining install index, official index availability/update data, runtime source state, tombstones, pending rollback state, and diagnostics. Add managed plugin command schemas in `plugin-commands.ts` and import them into `commands.ts`; do not add `pluginRpc.invoke` to the public PierCommand union. Do not remove `accounts.*`, `account:read`, or `account:write` in this task; that removal happens in Task 11 with all callers updated so `pnpm typecheck` stays green. Add `PLUGIN_RPC_EVENT: "pier://plugin-rpc:event"` to `PIER_BROADCAST` and `PLUGIN_RPC_INVOKE: "pier://plugin-rpc:invoke"` to the explicit `PIER` main/renderer IPC channel set in `src/shared/ipc-channels.ts`.

`officialPluginIndexSchema` must model the signed envelope fields: `version`, `sequence`, `generatedAt`, `plugins`, and `signature: { keyId, alg, value }`. The signature is parsed here but verified in Task 2 because verification needs canonical serialization and the pinned public key map.

In `permissions.ts` and `app-core/permissions.ts`, extend `CommandMetadata` from **capability-only** to **capability + optional `allowedClientKinds`** so managed plugin commands can be gated by client kind while pre-existing commands keep their capability-based behavior unchanged. Exact shape:

```ts
export interface CommandMetadata {
  readonly capabilities: readonly PierCapability[];
  // undefined = fall back to capability check (existing commands, backward compatible)
  // defined = only listed client kinds are allowed; every other kind is rejected before capability check
  readonly allowedClientKinds?: readonly PierClientKind[];
}
```

`authorizeCommand` order: check `allowedClientKinds` first (present-and-not-listed = reject with `permission_denied`), then check `capabilities`. Managed plugin entries:

- `plugin.catalog.list`: `allowedClientKinds: ["desktop-renderer", "cli-local"]`, `capabilities: ["plugin:read"]`.
- `plugin.checkUpdates`, `plugin.install`, `plugin.update`, `plugin.rollback`, `plugin.uninstall`, `plugin.enable`, `plugin.disable`, `plugin.devOverride.set`, `plugin.devOverride.clear`: `allowedClientKinds: ["desktop-renderer"]`, `capabilities: ["plugin:write"]`.

Tests must exercise: (a) `authorizeCommand({ type: "plugin.catalog.list" }, cliLocalClient)` returns `{ ok: true }`; (b) each mutation command returns `{ ok: false, reason: /client kind/ }` for `cli-local` even when the client is granted `plugin:write` capability; (c) `mcp-local` and `mobile-paired` clients are rejected for every managed plugin command because they are not listed; (d) existing capability-only commands (e.g. `plugin.list`, `git.getStatus`) behave unchanged when `allowedClientKinds` is omitted; (e) plugin RPC invoke is impossible through `PierCommand` (shared schema rejects the shape entirely).

- [ ] **Step 4: Run tests and typecheck target files**

Run:

```bash
pnpm vitest run tests/unit/shared/managed-plugin-contracts.test.ts
pnpm typecheck
```

Expected: test PASS and `pnpm typecheck` PASS. If typecheck fails because an account command/capability was removed too early, restore it and defer removal to Task 11b.

- [ ] **Step 5: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): add managed plugin contracts`

---

### Task 2: Install index persistence and package validation

**Files:**
- Create: `src/main/services/managed-plugins/paths.ts`
- Create: `src/main/services/managed-plugins/index-state.ts`
- Create: `src/main/services/managed-plugins/version.ts`
- Create: `src/main/services/managed-plugins/package-validation.ts`
- Create: `src/main/services/managed-plugins/official-index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/main/managed-plugin-install-foundation.test.ts`

**Interfaces:**
- Produces `createManagedPluginPaths(userDataDir)`.
- Produces `createManagedPluginIndexStore(indexFile)` with `init`, `get`, `mutate`, `flush`.
- Produces semver-backed `compareSemver`, `isPierRangeCompatible`, `selectLatestCompatibleVersion` using the `semver` package, not a hand-written partial range parser.
- Produces official index constants and cache behavior: `DEFAULT_OFFICIAL_PLUGIN_INDEX_URL = "https://pier.earendil.works/plugins/index.v1.json"`, pinned Ed25519 public key map keyed by `keyId`, dev/test-only env override `PIER_OFFICIAL_PLUGIN_INDEX_URL`, cache file `{userData}/plugins/official-index-cache.json`, and `fetchOfficialPluginIndex(...)` returning `{ index, diagnostics, source }`, where `source` is `"network" | "cache" | "empty"`. Network failure returns stale cache with diagnostics when cache exists, or an empty index with diagnostics when no cache exists. Production runtime must ignore the env override, fetch only the default URL, and add a diagnostic.
- Produces `MANAGED_PLUGIN_PACKAGE_LIMITS` production defaults and `validateManagedPluginPackage({ packageDir, archivePath, expectedId, expectedVersion, expectedSha256, expectedSize, pierVersion })`.
- Produces `validateTgzMembers(archivePath, options?)` and `extractTgzSafely(archivePath, stagingDir, options?)` using the `tar-stream` package with escape checks and default limits.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/managed-plugin-install-foundation.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManagedPluginIndexStore } from "@main/services/managed-plugins/index-state.ts";
import { createManagedPluginPaths } from "@main/services/managed-plugins/paths.ts";
import { extractTgzSafely, MANAGED_PLUGIN_PACKAGE_LIMITS, validateManagedPluginPackage } from "@main/services/managed-plugins/package-validation.ts";
import { downloadOfficialPluginAsset, fetchOfficialPluginIndex, selectLatestCompatibleVersion, validateOfficialAssetRedirect } from "@main/services/managed-plugins/official-index.ts";

let dir = "";

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pier-managed-plugins-")); });
afterEach(async () => { await rm(dir, { force: true, recursive: true }); });

// Compact fixtures may use fetchJson, but the test helper must JSON.stringify
// that object and feed the same raw-byte parser used by production.
// Order-sensitive tests use fetchRawJson directly.

async function createUnsafeTgzFixture(archivePath: string, entries: Array<{ path: string; content: string; type?: "file" | "symlink" | "link"; linkname?: string }>) {
  const { createGzip } = await import("node:zlib");
  const tar = await import("tar-stream");
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const gzip = createGzip();
  gzip.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>((resolve, reject) => {
    gzip.on("end", resolve);
    gzip.on("error", reject);
  });
  pack.pipe(gzip);
  for (const entry of entries) {
    pack.entry({ name: entry.path, type: entry.type ?? "file", linkname: entry.linkname }, entry.content);
  }
  pack.finalize();
  await finished;
  await writeFile(archivePath, Buffer.concat(chunks));
}

async function createPackage(version = "1.0.0") {
  const packageDir = join(dir, "package");
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ type: "module" }));
      await writeFile(join(packageDir, "plugin.json"), JSON.stringify({ apiVersion: 1, commands: [], dashboardWidgets: [], dataSchemas: { "codex.accounts": { read: ">=1 <=1", write: 1 } }, engines: { pier: ">=0.1.0 <0.2.0" }, id: "pier.codex", main: "dist/main.js", name: "Codex", panels: [], permissions: [], renderer: "dist/renderer.js", terminalStatusItems: [], version }));
  await writeFile(join(packageDir, "dist/main.js"), "import { join } from 'node:path';\nexport const plugin = {};\n");
  await writeFile(join(packageDir, "dist/renderer.js"), "export const plugin = {};\n");
  return packageDir;
}

describe("managed plugin install foundation", () => {
  it("derives userData plugin paths", () => {
    expect(createManagedPluginPaths("/tmp/pier")).toMatchObject({ indexFile: "/tmp/pier/plugins/index.json", installedDir: "/tmp/pier/plugins/installed", stagingDir: "/tmp/pier/plugins/staging", workDir: "/tmp/pier/plugins/work" });
  });

  it("persists the install index", async () => {
    const store = createManagedPluginIndexStore(join(dir, "plugins/index.json"));
    await store.init();
    store.mutate((state) => ({ ...state, plugins: { "pier.codex": { activeVersion: "1.0.0", devOverride: null, enabled: true, effectiveAtStartup: { version: "1.0.0", enabled: true, sourceKind: "official" }, id: "pier.codex", installedVersions: { "1.0.0": { installedAt: 1, packageUrl: "bundled://pier.codex/1.0.0", sha256: "seed" } }, pendingRestart: null, pendingUpdate: null, source: { kind: "official", seededFromBundle: true } } } }));
    await store.flush();
    expect(JSON.parse(await readFile(join(dir, "plugins/index.json"), "utf8")).plugins["pier.codex"].enabled).toBe(true);
  });

  it("validates manifest id, version, engine compatibility, and entries", async () => {
    await expect(validateManagedPluginPackage({ packageDir: await createPackage(), archivePath: null, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: null, pierVersion: "0.1.0" })).resolves.toMatchObject({ manifest: { id: "pier.codex" } });
    await expect(validateManagedPluginPackage({ packageDir: await createPackage(), archivePath: null, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: null, pierVersion: "0.2.0" })).rejects.toThrow(/incompatible Pier version/);
  });

  it("extracts a safe package archive under staging", async () => {
    const archivePath = join(dir, "safe.tgz");
    await createUnsafeTgzFixture(archivePath, [
      { path: "package.json", content: JSON.stringify({ type: "module" }) },
      { path: "plugin.json", content: JSON.stringify({ apiVersion: 1, commands: [], dashboardWidgets: [], dataSchemas: { "codex.accounts": { read: ">=1 <=1", write: 1 } }, engines: { pier: ">=0.1.0 <0.2.0" }, id: "pier.codex", main: "dist/main.js", name: "Codex", panels: [], permissions: [], renderer: "dist/renderer.js", terminalStatusItems: [], version: "1.0.0" }) },
      { path: "dist/main.js", content: "export const plugin = {};\n" },
      { path: "dist/renderer.js", content: "export const plugin = {};\n" },
    ]);
    const extractedDir = await extractTgzSafely(archivePath, join(dir, "staging-safe"));
    expect(await readFile(join(extractedDir, "package.json"), "utf8")).toContain("module");
    expect(await readFile(join(extractedDir, "plugin.json"), "utf8")).toContain("pier.codex");
    expect(await readFile(join(extractedDir, "dist", "main.js"), "utf8")).toContain("plugin");
    expect(await readFile(join(extractedDir, "dist", "renderer.js"), "utf8")).toContain("plugin");
  });

  it("rejects unsafe archive member paths before extraction", async () => {
    const archivePath = join(dir, "unsafe.tgz");
    await createUnsafeTgzFixture(archivePath, [{ path: "../escape.txt", content: "bad" }]);
    await expect(extractTgzSafely(archivePath, join(dir, "staging"))).rejects.toThrow(/unsafe archive member/);
    await expect(readFile(join(dir, "escape.txt"), "utf8")).rejects.toThrow();
  });

  it("rejects absolute archive member paths", async () => {
    const archivePath = join(dir, "absolute.tgz");
    await createUnsafeTgzFixture(archivePath, [{ path: "/tmp/escape.txt", content: "bad" }]);
    await expect(extractTgzSafely(archivePath, join(dir, "staging"))).rejects.toThrow(/unsafe archive member/);
  });

  it("rejects symlink and hardlink archive entries", async () => {
    const symlinkArchive = join(dir, "symlink.tgz");
    await createUnsafeTgzFixture(symlinkArchive, [{ path: "plugin/link", content: "", type: "symlink", linkname: "../escape" }]);
    await expect(extractTgzSafely(symlinkArchive, join(dir, "staging-symlink"))).rejects.toThrow(/links are not allowed/);
    const hardlinkArchive = join(dir, "hardlink.tgz");
    await createUnsafeTgzFixture(hardlinkArchive, [{ path: "plugin/link", content: "", type: "link", linkname: "../escape" }]);
    await expect(extractTgzSafely(hardlinkArchive, join(dir, "staging-hardlink"))).rejects.toThrow(/links are not allowed/);
  });

  it("rejects hash mismatch, size mismatch, and archive resource limit violations", async () => {
    const archivePath = join(dir, "plugin.tgz");
    await createUnsafeTgzFixture(archivePath, [{ path: "plugin.json", content: "{}" }]);
    expect(MANAGED_PLUGIN_PACKAGE_LIMITS).toMatchObject({ maxDepth: expect.any(Number), maxEntries: expect.any(Number), maxPathLength: expect.any(Number), maxTotalUncompressedBytes: expect.any(Number) });
    await expect(validateManagedPluginPackage({ packageDir: await createPackage(), archivePath, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: "wrong", expectedSize: null, pierVersion: "0.1.0" })).rejects.toThrow(/sha256 mismatch/);
    await expect(validateManagedPluginPackage({ packageDir: await createPackage(), archivePath, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: 999999, pierVersion: "0.1.0" })).rejects.toThrow(/size mismatch/);
    await expect(extractTgzSafely(archivePath, join(dir, "staging-size"), { maxEntryBytes: 1 })).rejects.toThrow(/entry too large/);
    await expect(extractTgzSafely(archivePath, join(dir, "staging-count"), { maxEntries: 0 })).rejects.toThrow(/too many entries/);
    await expect(extractTgzSafely(archivePath, join(dir, "staging-total"), { maxTotalUncompressedBytes: 1 })).rejects.toThrow(/archive too large/);
    await expect(extractTgzSafely(archivePath, join(dir, "staging-path"), { maxPathLength: 1 })).rejects.toThrow(/path too long/);
    await expect(extractTgzSafely(archivePath, join(dir, "staging-depth"), { maxDepth: 0 })).rejects.toThrow(/path too deep/);
    const duplicateArchive = join(dir, "duplicate.tgz");
    await createUnsafeTgzFixture(duplicateArchive, [{ path: "plugin/a.txt", content: "a" }, { path: "plugin/./a.txt", content: "b" }]);
    await expect(extractTgzSafely(duplicateArchive, join(dir, "staging-duplicate"))).rejects.toThrow(/duplicate archive member/);
    const caseDuplicateArchive = join(dir, "case-duplicate.tgz");
    await createUnsafeTgzFixture(caseDuplicateArchive, [{ path: "plugin/A.txt", content: "a" }, { path: "plugin/a.txt", content: "b" }]);
    await expect(extractTgzSafely(caseDuplicateArchive, join(dir, "staging-case-duplicate"))).rejects.toThrow(/duplicate archive member/i);
  });

  it("rejects packages without ESM marker and unresolved bare imports", async () => {
    const nonEsmPackage = await createPackage();
    await writeFile(join(nonEsmPackage, "package.json"), JSON.stringify({ type: "commonjs" }));
    await expect(validateManagedPluginPackage({ packageDir: nonEsmPackage, archivePath: null, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: null, pierVersion: "0.1.0" })).rejects.toThrow(/ESM package marker/);

    const rendererBarePackage = await createPackage();
    await writeFile(join(rendererBarePackage, "dist/renderer.js"), "import React from 'react';\nexport const plugin = {};\n");
    await expect(validateManagedPluginPackage({ packageDir: rendererBarePackage, archivePath: null, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: null, pierVersion: "0.1.0" })).rejects.toThrow(/unresolved renderer import/);

    const rendererEvalPackage = await createPackage();
    await writeFile(join(rendererEvalPackage, "dist/renderer.js"), "export const plugin = { activate() { return new Function('return 1')(); } };\n");
    await expect(validateManagedPluginPackage({ packageDir: rendererEvalPackage, archivePath: null, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: null, pierVersion: "0.1.0" })).rejects.toThrow(/eval is not allowed/);

    const mainBarePackage = await createPackage();
    await writeFile(join(mainBarePackage, "dist/main.js"), "import x from 'write-file-atomic';\nexport const plugin = {};\n");
    await expect(validateManagedPluginPackage({ packageDir: mainBarePackage, archivePath: null, expectedId: "pier.codex", expectedVersion: "1.0.0", expectedSha256: null, expectedSize: null, pierVersion: "0.1.0" })).rejects.toThrow(/unresolved main import/);
  });

  it("uses official index URL override and stale cache fallback", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache.json");
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ highestSequence: 1, versionHashes: {}, index: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }));
    const result = await fetchOfficialPluginIndex({ cachePath, env: { PIER_OFFICIAL_PLUGIN_INDEX_URL: "https://example.test/index.json" }, runtimeMode: "development", fetchJson: async () => { throw new Error("offline"); } });
    expect(result).toMatchObject({ index: { version: 1, sequence: 1, plugins: {} }, source: "cache", diagnostics: [expect.objectContaining({ severity: "warning" })] });
  });

  it("ignores official index URL override in production", async () => {
    const fetchedUrls: string[] = [];
    const result = await fetchOfficialPluginIndex({ cachePath: join(dir, "plugins/cache.json"), env: { PIER_OFFICIAL_PLUGIN_INDEX_URL: "https://example.test/index.json" }, runtimeMode: "production", verifySignature: () => true, fetchJson: async (url) => { fetchedUrls.push(url); return { finalUrl: url, json: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }; } });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/ignored.*PIER_OFFICIAL_PLUGIN_INDEX_URL/) })]));
    expect(fetchedUrls).toEqual(["https://pier.earendil.works/plugins/index.v1.json"]);
  });

  it("rejects official index rollback and same-version hash drift", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache.json");
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ generatedAt: 1, highestSequence: 10, versionHashes: { "pier.codex@1.0.0": "old" }, index: { generatedAt: 1, plugins: {}, sequence: 10, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }));
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 2, plugins: {}, sequence: 9, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }) })).rejects.toThrow(/official index rollback/);
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 2, plugins: { "pier.codex": { description: "Codex", displayName: "Codex", id: "pier.codex", latest: "1.0.0", versions: { "1.0.0": { assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz", pier: ">=0.1.0 <0.2.0", sha256: "new", size: 1 } } } }, sequence: 11, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }) })).rejects.toThrow(/hash drift/);
  });

  it("rejects unsigned indexes, unknown signing keys, non-allowlisted assets, and redirect escape", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache.json");
    const signedPayloads: string[] = [];
    await fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: ({ payload }) => { signedPayloads.push(payload); return true; }, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }) });
    expect(signedPayloads[0]).toBe('{"generatedAt":1,"plugins":{},"sequence":1,"version":1}');
    expect(signedPayloads[0]).not.toContain("signature");
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => false, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "bad" }, version: 1 } }) })).rejects.toThrow(/official index signature/);
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "RS256", value: "sig" }, version: 1 } }) })).rejects.toThrow(/unsupported signature algorithm/);
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "unknown", alg: "Ed25519", value: "sig" }, version: 1 } }) })).rejects.toThrow(/unknown signing key/);
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchJson: async (url) => ({ finalUrl: url, json: { generatedAt: 1, plugins: { "pier.codex": { description: "Codex", displayName: "Codex", id: "pier.codex", latest: "1.0.0", versions: { "1.0.0": { assetUrl: "https://github.com/untrusted/codex/releases/download/v1.0.0/pkg.tgz", pier: ">=0.1.0 <0.2.0", sha256: "h", size: 1 } } } }, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }) })).rejects.toThrow(/non-allowlisted GitHub asset/);
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchJson: async () => ({ finalUrl: "https://evil.test/index.json", json: { generatedAt: 1, plugins: {}, sequence: 1, signature: { keyId: "pier-official-2026-01", alg: "Ed25519", value: "sig" }, version: 1 } }) })).rejects.toThrow(/official index redirect/);
    await expect(validateOfficialAssetRedirect({ assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz", finalUrl: "https://release-assets.githubusercontent.com/github-production-release-asset/1/pkg.tgz?sp=r" })).resolves.toBeUndefined();
    await expect(validateOfficialAssetRedirect({ assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz", finalUrl: "http://release-assets.githubusercontent.com/github-production-release-asset/1/pkg.tgz" })).rejects.toThrow(/asset redirect/);
    await expect(validateOfficialAssetRedirect({ assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz", finalUrl: "https://user:pass@release-assets.githubusercontent.com/github-production-release-asset/1/pkg.tgz" })).rejects.toThrow(/asset redirect/);
    await expect(downloadOfficialPluginAsset({ assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz", maxRedirects: 2, fetch: redirectLoopFetch })).rejects.toThrow(/too many redirects/);
    await expect(validateOfficialAssetRedirect({ assetUrl: "https://github.com/pier-plugins/codex/releases/download/v1.0.0/pkg.tgz", finalUrl: "https://evil.test/pkg.tgz" })).rejects.toThrow(/asset redirect/);
  });

  it("verifies signatures before strict schema parsing and never signs stripped data", async () => {
    const cachePath = join(dir, "plugins", "official-index-cache-order.json");
    const signedPayloads: string[] = [];
    await expect(fetchOfficialPluginIndex({
      cachePath,
      runtimeMode: "development",
      env: {},
      verifySignature: ({ payload }) => { signedPayloads.push(payload); return true; },
      fetchRawJson: async () => '{"generatedAt":1,"plugins":{},"sequence":1,"unexpectedForwardField":true,"version":1,"signature":{"keyId":"pier-official-2026-01","alg":"Ed25519","value":"sig"}}',
    })).rejects.toThrow(/official index schema/);
    expect(signedPayloads[0]).toContain('"unexpectedForwardField":true');
    await expect(fetchOfficialPluginIndex({ cachePath, runtimeMode: "development", env: {}, verifySignature: () => true, fetchRawJson: async () => '{"generatedAt":1,"generatedAt":2,"plugins":{},"sequence":1,"version":1,"signature":{"keyId":"pier-official-2026-01","alg":"Ed25519","value":"sig"}}' })).rejects.toThrow(/duplicate key/);
  });

  it("selects the highest compatible official version", () => {
    const selected = selectLatestCompatibleVersion({ description: "Codex", displayName: "Codex", id: "pier.codex", latest: "2.0.0", versions: { "1.0.0": { assetUrl: "https://github.com/a/b/releases/download/v1/pkg.tgz", pier: ">=0.1.0 <0.2.0", sha256: "1", size: 10 }, "1.1.0": { assetUrl: "https://github.com/a/b/releases/download/v1.1/pkg.tgz", pier: ">=0.1.0 <0.2.0", sha256: "2", size: 10 }, "2.0.0": { assetUrl: "https://github.com/a/b/releases/download/v2/pkg.tgz", pier: ">=0.2.0 <0.3.0", sha256: "3", size: 10 } } }, "0.1.5");
    expect(selected?.version).toBe("1.1.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/managed-plugin-install-foundation.test.ts`

Expected: FAIL because the managed plugin main service files do not exist.

- [ ] **Step 3: Implement foundation files**

Implement:

```ts
// paths.ts
export function createManagedPluginPaths(userDataDir: string) {
  const pluginsDir = join(userDataDir, "plugins");
  return { pluginsDir, indexFile: join(pluginsDir, "index.json"), installedDir: join(pluginsDir, "installed"), stagingDir: join(pluginsDir, "staging"), workDir: join(pluginsDir, "work") };
}
```

Implement `version.ts` using the mature `semver` package. Reject invalid versions and invalid ranges with explicit diagnostics; use `semver.satisfies(pierVersion, range, { includePrerelease: false })` for engine checks and `semver.rcompare` for latest compatible selection. Add `semver` and `@types/semver` as needed.

Implement `package-validation.ts` with these exact exported functions and behaviors:

```ts
export const MANAGED_PLUGIN_PACKAGE_LIMITS = {
  maxDepth: 16,
  maxEntries: 2048,
  maxEntryBytes: 10 * 1024 * 1024,
  maxPathLength: 240,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
} as const;
export function assertSafeArchiveMemberPath(memberPath: string): void;
export async function validateTgzMembers(archivePath: string, options?: { maxEntryBytes?: number; maxEntries?: number; maxTotalUncompressedBytes?: number; maxPathLength?: number; maxDepth?: number }): Promise<void>;
export async function extractTgzSafely(archivePath: string, stagingDir: string, options?: { maxEntryBytes?: number; maxEntries?: number; maxTotalUncompressedBytes?: number; maxPathLength?: number; maxDepth?: number }): Promise<string>;
export async function validateManagedPluginPackage(options: ValidateManagedPluginPackageOptions & { pierVersion: string }): Promise<ValidatedManagedPluginPackage>;
```

Required behavior:

- `assertSafeArchiveMemberPath` normalizes with `node:path.posix.normalize`, rejects empty paths, absolute paths, paths starting with `..`, paths containing `/../`, and Windows drive/UNC-looking paths.
- `validateTgzMembers` streams `archivePath` through `createGunzip()` into `tar-stream.extract()`, accepts only regular files and directories, rejects `symlink`, `link`, device, fifo, unknown, and every other tar entry type, rejects duplicate normalized paths including case-insensitive duplicates on macOS/Windows, rejects entries larger than `maxEntryBytes`, more than `maxEntries`, total uncompressed bytes above `maxTotalUncompressedBytes`, paths longer than `maxPathLength`, and directory depth above `maxDepth`, drains every accepted entry stream, performs no filesystem writes, and resolves only after the tar stream finishes.
- `extractTgzSafely` first awaits `validateTgzMembers`, creates `stagingDir`, streams the archive a second time, validates every header before joining paths, verifies each target remains under `realpath(stagingDir)`, writes files through temporary sibling names followed by `rename`, creates directories with mode `0o755`, rejects links again during extraction, and resolves to `stagingDir` only after all writes finish.
- All archive and package-directory validation entry points merge caller options over `MANAGED_PLUGIN_PACKAGE_LIMITS`; production install paths must not call them with unbounded limits. `validateManagedPluginPackage` enforces the same entry count, total bytes, path length, and depth limits while traversing already-extracted package directories, so bundled seed directories and dev override directories receive equivalent resource-limit coverage even when no `.tgz` is involved.
- `validateManagedPluginPackage` checks archive size/hash when `archivePath` is present, parses root `package.json`, requires `{ "type": "module" }` as the package-local ESM marker for `dist/main.js`, parses `plugin.json` with `managedPluginPackageManifestSchema`, requires expected id/version, rejects incompatible `manifest.engines.pier` using `isPierRangeCompatible(manifest.engines.pier, pierVersion)`, requires main and renderer entry files under `packageDir`, and rejects unsafe entry paths before file access. It must scan every official seed/update and dev-override package before install: parse every emitted JS chunk with a parser and inspect static imports, re-exports, and literal dynamic imports; renderer entry plus emitted text JS/CSS chunks must not contain browser-unresolvable bare imports (reject `react`, `react/jsx-runtime`, `react-dom`, `@pier/plugin-api`, `@pier/ui`, `lucide-react`, CSS `@import` bare specifiers, or any other bare import left in output; binary assets are not parsed); main entry plus emitted JS chunks may import only relative specifiers and `node:` builtins. v1 official external plugin main bundles may not import `electron`; `ELECTRON_MAIN_IMPORT_ALLOWLIST` is empty unless a later design adds a named Electron API with tests. Runtime dependencies such as `write-file-atomic` must be bundled. Non-literal dynamic imports are rejected in v1 unless they are statically proven to be relative package-internal paths. Seed install, official update install, and dev override validation must all pass `pierVersion`.

Add `tar-stream`, `semver`, and the parser dependency chosen for JS import scanning as runtime dependencies for safe `.tgz` inspection/extraction and version selection, then use project patterns from `src/main/state/*` for JSON persistence in `index-state.ts`. In `official-index.ts`, define `DEFAULT_OFFICIAL_PLUGIN_INDEX_URL = "https://pier.earendil.works/plugins/index.v1.json"`, `OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID`, dev/test-only `PIER_OFFICIAL_PLUGIN_INDEX_URL`, signature verification over the canonical index payload, GitHub owner/repo allowlist checks, sequence rollback detection, and same-version hash-drift detection. Verification order is fixed: fetch raw bytes with a size cap, parse UTF-8 JSON with duplicate object-key rejection, extract only the minimal `signature` envelope, canonicalize the complete parsed object with `signature` omitted, verify that payload, then run strict `officialPluginIndexSchema` validation that rejects unknown fields. Do not canonicalize a Zod-stripped object. Canonical signing payload is encoded as UTF-8 canonical JSON with object keys sorted, no insignificant whitespace, and stable primitive encoding; reject `alg` values other than `Ed25519` and unknown `keyId`. Fetch must inspect the final response URL after redirects and reject redirects outside the official index host for the index itself. Asset URLs in the signed index must be `https://github.com/<allowlisted-owner>/<allowlisted-repo>/releases/download/<tag>/<asset>.tgz`; asset download may follow only a bounded number of HTTPS redirects to `github.com`, `objects.githubusercontent.com`, or `release-assets.githubusercontent.com`, and must reject any other host, non-HTTPS scheme, credentialed URL, or redirect loop before hash/size verification. Fetch and validate `officialPluginIndexSchema`, write successful responses plus highest sequence/hash memory to `{userData}/plugins/official-index-cache.json`, and return `OfficialPluginIndexFetchResult = { index, diagnostics, source }`. On network failure, return `{ index: cachedIndex, source: "cache", diagnostics }` if cache exists, otherwise `{ index: emptyOfficialIndex, source: "empty", diagnostics }`.

- [ ] **Step 4: Run foundation tests**

Run: `pnpm vitest run tests/unit/main/managed-plugin-install-foundation.test.ts`

Expected: PASS.

- [ ] **Step 5: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): add managed plugin install foundation`

---

### Task 3: Managed install service, plugin sources, and bundled seed

**Files:**
- Create: `src/main/services/managed-plugins/install-service.ts`
- Create: `src/main/services/managed-plugins/operation-log.ts`
- Modify: `src/main/services/plugin-sources.ts`
- Modify: `src/main/services/plugin-service.ts`
- Modify: `src/main/state/plugin-state.ts`
- Modify: `src/main/app-core/app-core.ts`
- Modify: `src/main/app-core/command-router-services.ts`
- Modify: `src/main/app-core/command-router.ts`
- Modify: `src/shared/contracts/commands.ts`
- Create: `src/preload/plugin-management-api.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/unit/main/managed-plugin-install-service.test.ts`
- Test: `tests/unit/main/plugin-service.test.ts`
- Test: `tests/unit/main/plugin-sources.test.ts`
- Test: `tests/unit/app-core/command-router.test.ts`
- Test: `tests/unit/preload/plugin-management-api.test.ts`

**Interfaces:**
- Produces `ManagedPluginInstallService` with seed install, `listCatalogSnapshot`, boot-time source snapshot, enable/disable, uninstall, check updates, update, rollback, set/clear dev override, and activation-result recording.
- Produces `appendManagedPluginOperationLog(record)` for security-relevant operations.
- Produces source kinds `officialInstalled` and `devOverride` consumed by `plugin-service.ts` from the boot snapshot, not from mutable index state during the current process.
- Produces renderer entry URLs such as `pier-plugin://pier.codex/1.0.0/dist/renderer.js`.
- Produces migration from existing `plugin-state.json` enabled flags into the managed install index for managed plugins, while keeping builtin plugin toggles behind the `PluginService.setEnabled` facade until all builtin plugins are migrated.
- Produces uninstall tombstones so bundled seed install respects explicit user uninstall intent.
- Produces `lastKnownGoodVersion` and rollback behavior: a version becomes last-known-good only after main and renderer activation complete and data schema compatibility is confirmed; activation failure preserves the previous last-known-good record, records diagnostics, and suggests next-start rollback without switching code versions in the current process.
- Produces a single mutation queue around install index writes, official-index cache writes, operation-log appends, and filesystem promotion/cleanup decisions.
- Produces a managed catalog snapshot combining install index desired state, official index availability/update state, effective boot-time runtime registry entries, tombstones, pendingRestart operations, and diagnostics for settings UI Installed/Available sections. Catalog rows carry an `offlineRestoreAvailable: boolean` flag: true when the target id has a tombstone AND the bundled seed sha256/id/version matches an already-seen official hash (from `installedVersions` or the cached `versionHashes` map) AND the seed manifest's `engines.pier` accepts the current app.
- Produces boot reconciliation that applies desired next-start state to `effectiveAtStartup`, clears `pendingRestart` once it is effective, revalidates dev overrides before adding them to the runtime snapshot, and preserves current-boot assets/code until no runtime snapshot references them.
- Produces `checkUpdates()` rate limiting: `fetchOfficialPluginIndex` refuses to hit network more than once per `OFFICIAL_INDEX_MIN_INTERVAL_MS = 60_000`; a call inside the window returns the cached snapshot plus a `{ severity: "info", code: "rate_limited", nextAllowedAt }` diagnostic instead of a 4th call to `pier.earendil.works`. Manual "Check for Updates" clicks in the UI surface this as a non-error toast "Recently checked; try again in Ns" rather than a failure.
- Produces `restoreFromBundledSeed(pluginId)`: called by `plugin.install(pluginId)` when the official index is unreachable AND the plugin currently has an uninstall tombstone. It succeeds only when the bundled seed's sha256/id/version has been previously seen in `installedVersions` or the `versionHashes` cache (never allow an unverified bundle to override the last-known official pin), engine compatibility holds, and the seed passes full `validateManagedPluginPackage` with `MANAGED_PLUGIN_PACKAGE_LIMITS`. On success it clears the tombstone, installs the seed as `source: { kind: "official", seededFromBundle: true }`, writes an operation-log entry with `operation: "install-from-bundle"`, and returns `{ requiresRestart: true }`. All other cases return `{ ok: false, error: { code: "denied", message: "Official index unreachable and bundled seed does not match a previously verified official hash" } }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/managed-plugin-install-service.test.ts` with tests for:

```ts
expect(await service.ensureBundledSeedInstalled({ id: "pier.codex", version: "1.0.0", packageDir, sha256: "seed" })).toMatchObject({ pluginId: "pier.codex", requiresRestart: false, version: "1.0.0" });
expect(await service.listRuntimeSources()).toEqual([expect.objectContaining({ enabled: true, kind: "officialInstalled", rendererEntryUrl: "pier-plugin://pier.codex/1.0.0/dist/renderer.js" })]);
const disableResult = await service.disable("pier.codex");
expect(disableResult).toMatchObject({ requiresRestart: true });
expect((await service.listRuntimeSources())[0]).toMatchObject({ enabled: true, kind: "officialInstalled", version: "1.0.0" });
await service.simulateRestartForTests();
expect((await service.listRuntimeSources())[0]).toMatchObject({ enabled: false, kind: "officialInstalled", version: "1.0.0" });
await service.enable("pier.codex");
await service.simulateRestartForTests();
const overrideResult = await service.setDevOverride("pier.codex", devPackageDir);
expect(overrideResult).toMatchObject({ requiresRestart: true });
expect((await service.listRuntimeSources())[0]).toMatchObject({ kind: "officialInstalled", version: "1.0.0" });
await service.simulateRestartForTests();
expect((await service.listRuntimeSources())[0]).toMatchObject({ kind: "devOverride", version: "1.0.1" });
await mkdir(join(paths.workDir, "pier.codex"), { recursive: true });
await writeFile(join(paths.workDir, "pier.codex", "marker.txt"), "keep");
await service.uninstall("pier.codex");
await service.ensureBundledSeedInstalled({ id: "pier.codex", version: "1.0.0", packageDir, sha256: "seed" });
await service.simulateRestartForTests();
expect(await service.listRuntimeSources()).toEqual([]);
expect(await readFile(join(paths.workDir, "pier.codex", "marker.txt"), "utf8")).toBe("keep");
```

Add explicit tests for boot reconciliation: after `simulateRestartForTests()` applies pending disable/enable/update/devOverride/uninstall operations, `listCatalogSnapshot()` must show `pendingRestart: null` and `effective` matching `desired` or `null` for uninstall. Add uninstall timing tests that call `uninstall("pier.codex")` before restart and verify `listRuntimeSources()` still contains the old effective source and its package path/assets remain available for the current boot; physical cleanup of installed code may only run after `simulateRestartForTests()` no longer references that version. Add dev-override drift tests that set a valid dev override, mutate/remove its `package.json` or leave an unresolved bare import before restart, and verify startup revalidation records diagnostics and falls back to the installed active version if present/enabled, otherwise to no runtime source.

Add explicit atomicity tests that simulate `copyDirectory` throwing before final rename and verify `installed/<id>/<version>` and `index.json` remain unchanged, then create a stale `installed/<id>/.<version>.tmp` sibling and verify service initialization ignores/cleans it before a later successful install.

Add rollback and reinstall tests: install `1.1.0`, simulate external runtime activation failure via `recordActivationResult({ pluginId: "pier.codex", version: "1.1.0", phase: "main", ok: false, diagnosticId })`, verify the current process runtime snapshot does not switch to another version and only records diagnostics / rollback suggestion, then call `simulateRestartForTests()` and verify the next-start boot snapshot falls back to `lastKnownGoodVersion: "1.0.0"`; then simulate successful main + renderer activation and verify `lastKnownGoodVersion` advances only after both phases have succeeded. Add multi-window renderer tests: duplicate success reports for the same window do not double-advance, one window failure records diagnostics, and no-window startup does not promote the desired version until a renderer activation result is observed. Add rollback target tests: `rollback(id, version)` rejects versions that are not installed, whose stored sha256 does not match first-seen official hash, whose package validation fails, whose data schema range is incompatible with current plugin work data, or that are neither `lastKnownGoodVersion` nor a user-confirmed explicitly installed previous version. Uninstall `pier.codex`, verify `work/pier.codex` survives, reinstall, and verify the tombstone is cleared, work data is reused, and legacy account migration does not rerun over existing plugin data.

Add dev override gating tests: `setDevOverride` and `clearDevOverride` succeed in development/test runtime, but return a denied `ManagedPluginOperationResult` and write diagnostics in production runtime without mutating index state or runtime snapshots. Seed an `index.json` that already contains `devOverride`, initialize the service in production runtime, and assert boot reconciliation ignores the local path without stat/read/validation, records diagnostics, uses the installed active version if valid/enabled or no source otherwise, and never marks the local path as official. Add resource-limit integration tests proving bundled seed validation, official install/update extraction, and dev override validation all call package/archive validation with `MANAGED_PLUGIN_PACKAGE_LIMITS` defaults and fail before index mutation when limits are exceeded. Add operation-log tests asserting install, update, rollback, uninstall, enable/disable, and dev override attempts append records containing timestamp, operation, actor kind, plugin id, old/new versions, official index sequence, asset URL, sha256, signing key id, result, and diagnostic id when present. Add a governance test that operation logs and managed-plugin diagnostics never include raw `auth.json`, refresh/access tokens, safeStorage ciphertext, or plugin secret values. Add concurrency tests that start `update`, `disable`, and `rollback` concurrently and assert the service serializes mutations, index version/revision increments monotonically, and operation-log order matches committed state. Add seed hash and compatibility tests: bundled seed install records `pier.codex@<seedVersion>` into official-index first-seen hash memory, a later official index declaring the same id/version with a different sha256 is rejected as hash drift, and when an installed active version becomes incompatible with the current Pier engine while the bundled seed is compatible and no uninstall tombstone exists, startup reconciliation restores desired/effective source to the seed version and logs diagnostics. Add a tombstone variant proving seed compatibility recovery does not resurrect a user-uninstalled plugin.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/managed-plugin-install-service.test.ts`

Expected: FAIL because `install-service.ts` does not exist.

- [ ] **Step 3: Implement install service**

Implement `createManagedPluginInstallService({ paths, store, pluginStateStore, officialIndexCache, pierVersion, now, runtimeMode, copyDirectory, fetchOfficialIndex, downloadArchive, extractArchive, appendOperationLog })`. All public mutation methods enter one async mutation queue before touching `index.json`, official-index cache, operation log, staging, installed temp siblings, or cleanup decisions; reads can use snapshots but must not observe half-committed mutations. Use safe extraction into `staging/<id>-<version>-<timestamp>` with `MANAGED_PLUGIN_PACKAGE_LIMITS`, validate there, copy into a temp sibling such as `installed/<id>/.<version>.<timestamp>.tmp`, validate the copied temp package with `MANAGED_PLUGIN_PACKAGE_LIMITS`, then atomically `rename` the temp sibling to `installed/<id>/<version>` before mutating `index.json`. Never mutate the index until the final version directory exists; on startup/initialization, ignore and best-effort clean incomplete `.tmp` siblings and stale staging dirs. Keep old installed versions. Bundled seed directories, official install/update archives, rollback candidates, and dev override directories all run through `validateManagedPluginPackage` with the same default limits; there is no unbounded fast path for packaged resources or local override directories. During bundled seed install, compute the seed package sha256 and record it as the first-seen hash for `pluginId@version` in the official index cache/hash memory; later remote official indexes with the same id/version must match that hash. If an app upgrade bundles the same `pluginId@version` with a different seed hash than cached or installed first-seen memory, reject the seed as a build/supply-chain inconsistency and keep the existing verified version when possible. If the official-index cache is missing but `index.json.installedVersions[version].sha256` exists, rebuild first-seen memory from the installed verified hash before accepting a remote index for that version. If boot reconciliation finds an installed active version whose manifest `engines.pier` is incompatible with the current app, and the bundled seed version is compatible, restore the desired active version to the seed and log diagnostics unless an uninstall tombstone exists. During boot reconciliation (and `simulateRestartForTests()`), resolve desired state into a fresh runtime snapshot, update `effectiveAtStartup`, and clear `pendingRestart` for operations whose desired state is now effective. In development/test runtime, revalidate any `devOverride` package at boot before using it; store and compare `realpath` for dev override directories, record diagnostics if the path target changes unexpectedly, and fall back to the installed active version when enabled/valid, otherwise omit the runtime source for that plugin. In production runtime, ignore any persisted `devOverride` without touching the local path, record diagnostics and an operation-log entry, and always resolve from installed official versions. `setDevOverride` and `clearDevOverride` must be hard-gated to development/test runtime; in production they return a denied operation result, log the attempt, and do not mutate index state. Capture a boot-time runtime source snapshot after seed/dev override resolution; `listRuntimeSources()` returns that snapshot for the current process. For external plugins, `enable(id)`, `disable(id)`, `update(id)`, `rollback(id, version)`, `setDevOverride(id, path)`, `clearDevOverride(id)`, and `uninstall(id)` mutate next-start install state and return `requiresRestart: true` without changing the current runtime source snapshot. `uninstall(id)` writes a tombstone record such as `{ id, enabled: false, activeVersion: null, uninstalledAt }` instead of deleting all state, preserves `work/<id>`, and `ensureBundledSeedInstalled` must not reinstall a plugin with an uninstall tombstone. Reinstall clears the tombstone and reuses `work/<id>`. Before restart, uninstall is logical only: keep the effective version directory/assets available to `pier-plugin://` and the current runtime snapshot. Physical cleanup of installed code is allowed only after boot reconciliation confirms no current runtime snapshot references that version. v1 intentionally avoids immediate per-plugin deactivate/reactivate because that would require unloading main RPC handlers, timers, watchers, renderer contributions, and React component trees safely.

Track `lastKnownGoodVersion` through an explicit `recordActivationResult({ pluginId, version, phase, ok, windowId?, diagnosticId?, error? })` API called by the external main runtime and renderer runtime. A version installed by update does not become last-known-good until main activation reports success, at least one renderer activation reports success, no recorded phase has failed for that version, the package hash still matches stored verified hash, and every schema in `work/<id>/.pier-plugin-data-schemas.json` is allowed by that version's manifest `dataSchemas[*].read` range. If the marker file is absent, treat compatibility as no host-known work-data constraint; the generic install service must not scan plugin-private files to infer schema ownership. Plugins that own schema data, including `pier.codex`, must write or repair the marker before reporting activation success. If the marker is malformed or names a schema absent from the candidate manifest, fail closed for rollback and last-known-good promotion. Deduplicate renderer reports by `windowId` / plugin instance. If activation fails during startup, do not load a different plugin version in the same process. Instead, keep the failed plugin unavailable or renderer-fallback-only for the current boot, set diagnostics and a rollback suggestion/pending restart state, and let explicit `rollback(id, version)` or the next boot reconciliation activate the older version. `rollback(id, version)` must use the same validation path and may only target an installed verified version that is `lastKnownGoodVersion` or an explicitly user-confirmed previous installed version.

Implement `operation-log.ts` as JSON Lines under `{userData}/plugins/operation-log.jsonl`. It is a minimum audit trail, not a policy engine: append after every attempted install/update/rollback/uninstall/enable/disable/dev override operation with `{ timestamp, actorKind: "desktop-renderer" | "cli-local" | "startup", operation, pluginId, fromVersion?, toVersion?, officialIndexSequence?, assetUrl?, sha256?, signingKeyId?, result: "success" | "denied" | "failed", diagnosticId? }`. Never include secrets or auth contents.

Migrate existing `plugin-state.json` entries for managed plugin ids into `index.json` during install-service initialization. After migration, managed plugin enabled state is read/written only through `index.json`; builtin plugin enabled state continues to use the existing plugin-state store through `PluginService.setEnabled` until those plugins are separately migrated.

- [ ] **Step 4: Wire plugin discovery**

Modify `plugin-sources.ts` to merge builtin sources with `installService.listRuntimeSources()` and remove the legacy flat `userData/plugins/<dir>/plugin.json` local scan entirely. For v1, every local development path must go through validated `setDevOverride()` prebuilt package directories recorded in the install index. Add tests that default discovery returns only builtin sources plus managed runtime sources and does not scan arbitrary `userData/plugins/<dir>/plugin.json`. Modify `plugin-service.ts` so external package manifests are normalized into `PluginRegistryEntry` with runtime `kind: "external"`, `rendererEntryUrl` from the install service, and effective `manifest.source` derived from the runtime source: official installs use `{ kind: "official" }`, while dev overrides retain a non-official/dev source so the runtime registry and settings UI can display the stronger local-code warning and never mislabel local override code as official.

- [ ] **Step 5: Wire commands and preload**

In `command-router.ts`, dispatch:

```ts
case "plugin.catalog.list": return services.managedPlugins.listCatalogSnapshot();
case "plugin.install": return services.managedPlugins.installOfficial(command.id);
case "plugin.update": return services.managedPlugins.updateOfficial(command.id);
case "plugin.rollback": return services.managedPlugins.rollback(command.id, command.version);
case "plugin.uninstall": return services.managedPlugins.uninstall(command.id);
case "plugin.enable": return services.plugins.setEnabled(command.id, true);
case "plugin.disable": return services.plugins.setEnabled(command.id, false);
case "plugin.checkUpdates": return services.managedPlugins.checkUpdates();
case "plugin.devOverride.set": return services.managedPlugins.setDevOverride(command.id, command.path);
case "plugin.devOverride.clear": return services.managedPlugins.clearDevOverride(command.id);
```

Before dispatch, rely on the app-core authorization matrix so `cli-local` can call only `plugin.catalog.list`; command-router tests must exercise both allowed `desktop-renderer` mutations and rejected `cli-local` mutations. Move the existing inline `PierPluginsAPI` interface and `window.pier.plugins` implementation out of `src/preload/index.ts` into `src/preload/plugin-management-api.ts`, keeping `window.pier.plugins.list()` unchanged as the runtime registry list returning `PluginRegistryListResult` for bootstrap/configuration consumers. Add a separate `window.pier.managedPlugins` facade with the full managed operation surface: `list(): Promise<ManagedPluginCatalogSnapshot>`, `checkUpdates(): Promise<ManagedPluginCatalogSnapshot>`, `install(id): Promise<ManagedPluginOperationResult>`, `update(id): Promise<ManagedPluginOperationResult>`, `rollback(id, version): Promise<ManagedPluginOperationResult>`, `uninstall(id): Promise<ManagedPluginOperationResult>`, `enable(id): Promise<ManagedPluginOperationResult>`, `disable(id): Promise<ManagedPluginOperationResult>`, `setDevOverride(id, path): Promise<ManagedPluginOperationResult>`, and `clearDevOverride(id): Promise<ManagedPluginOperationResult>`. These call `plugin.catalog.list`, `plugin.checkUpdates`, `plugin.install`, `plugin.update`, `plugin.rollback`, `plugin.uninstall`, `plugin.enable`, `plugin.disable`, `plugin.devOverride.set`, and `plugin.devOverride.clear` respectively. Keep `src/preload/index.ts` as composition glue so it shrinks rather than grows past the 500-line hard cap. `PluginService.setEnabled(id, enabled)` is the single enable/disable facade: for managed external plugin ids it delegates to managed install index persistence and returns `ManagedPluginOperationResult` with `requiresRestart: true`, while the current runtime snapshot remains unchanged until restart; for remaining builtin ids it returns the existing `PluginRegistryEntry`. Add an explicit union result type such as `PluginToggleResult = PluginRegistryEntry | ManagedPluginOperationResult`, thread it through shared command return typing, `PierPluginsAPI`, settings UI tests, and command-router returns. Add tests that runtime `plugin.list` still returns `PluginRegistryListResult`, managed catalog listing returns `ManagedPluginCatalogSnapshot`, every `window.pier.managedPlugins.*` method dispatches the expected command, toggling a builtin plugin still persists immediately, toggling `pier.codex` persists only through the managed index with a restart-required result, and `cli-local` cannot invoke check/update/install/rollback/uninstall/enable/disable/devOverride commands.

- [ ] **Step 6: Run install service tests**

Run:

```bash
pnpm vitest run tests/unit/main/managed-plugin-install-service.test.ts tests/unit/main/plugin-service.test.ts tests/unit/main/plugin-sources.test.ts tests/unit/app-core/command-router.test.ts tests/unit/preload/plugin-management-api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): manage installed external plugins`

---

### Task 4: `pier-plugin://` protocol, CSP, and startup ordering

**Files:**
- Create: `src/main/plugins/plugin-asset-protocol.ts`
- Create: `tests/fixtures/plugin-asset/fixture.plugin/plugin.json`
- Create: `tests/fixtures/plugin-asset/fixture.plugin/dist/renderer.js`
- Modify: `src/main/index.ts`
- Modify: `src/main/csp.ts`
- Modify: `src/main/app-core/app-core.ts`
- Test: `tests/unit/main/plugin-asset-protocol.test.ts`
- Test: `tests/unit/main/plugin-startup-order.test.ts`
- Test: `tests/e2e/plugin-asset-protocol.spec.ts`

**Interfaces:**
- Produces `registerPluginAssetScheme(): void`, called before `app.whenReady()`.
- Produces `handlePluginAssetProtocol(options): void`, called after `configureAppIdentity()` and managed plugin runtime sources are initialized.
- Maps `pier-plugin://<pluginId>/<version>/<relative-path>` only to the boot-time runtime source root for that plugin/version.

- [ ] **Step 1: Write failing protocol and startup-order tests**

Create tests asserting:

```ts
const callOrder: string[] = [];
registerPluginAssetScheme({ record: (name) => callOrder.push(name) });
configureAppIdentityForTests({ record: (name) => callOrder.push(name) });
createAppCoreForTests({ record: (name) => callOrder.push(name) });
expect(callOrder).toEqual(["registerPluginAssetScheme", "configureAppIdentity", "createAppCore"]);
expect(resolvePluginAssetPath({ pluginId: "fixture.plugin", version: "0.0.0", relativePath: "dist/renderer.js" })).toEqual(join(installedDir, "fixture.plugin", "0.0.0", "dist/renderer.js"));
expect(() => resolvePluginAssetPath({ pluginId: "fixture.plugin", version: "0.0.0", relativePath: "../secrets.json" })).toThrow(/unsafe plugin asset path/);
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "production" }), "script-src")).toEqual(expect.arrayContaining(["'self'", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "development" }), "script-src")).toEqual(expect.arrayContaining(["'self'", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "production" }), "script-src")).not.toEqual(expect.arrayContaining(["'unsafe-eval'"]));
// dev mode intentionally keeps 'unsafe-eval': Vite HMR + react-refresh require it, removing it breaks `pnpm dev`.
// The plugin eval prohibition is enforced independently by package validation (Task 2/3), so this dev-only CSP exception does not weaken the plugin trust posture.
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "development" }), "script-src")).toEqual(expect.arrayContaining(["'unsafe-eval'"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "production" }), "style-src")).toEqual(expect.arrayContaining(["'self'", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "development" }), "style-src")).toEqual(expect.arrayContaining(["'self'", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "production" }), "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "development" }), "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "production" }), "font-src")).toEqual(expect.arrayContaining(["'self'", "data:", "pier-asset:", "pier-plugin:"]));
expect(parseCspDirective(createContentSecurityPolicyForTests({ mode: "development" }), "font-src")).toEqual(expect.arrayContaining(["'self'", "data:", "pier-asset:", "pier-plugin:"]));
expect(createPluginAssetResponseForTests("pier-plugin://fixture.plugin/0.0.0/dist/renderer.js", { origin: "http://localhost:5173" })).toMatchObject({ headers: expect.objectContaining({ "content-type": "text/javascript", "access-control-allow-origin": "http://localhost:5173", "x-content-type-options": "nosniff", vary: "Origin" }) });
expect(createPluginAssetResponseForTests("pier-plugin://fixture.plugin/0.0.0/dist/renderer.js", { origin: "http://localhost:5173" }).headers).not.toHaveProperty("access-control-allow-credentials");
expect(() => resolvePluginAssetPath({ pluginId: "fixture.plugin", version: "0.0.0", relativePath: "../../work/fixture.plugin/accounts.json" })).toThrow(/unsafe plugin asset path/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/main/plugin-asset-protocol.test.ts tests/unit/main/plugin-startup-order.test.ts`

Expected: FAIL because protocol helper and startup-order wiring do not exist. Do not put `import("pier-plugin://...")` in Vitest unit tests; Node/Vitest cannot resolve Electron custom protocols.

- [ ] **Step 3: Implement protocol registration and handler**

Register `pier-plugin` with `protocol.registerSchemesAsPrivileged([{ scheme: "pier-plugin", privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }])` before `app.whenReady()`, matching the CORS-compatible posture needed for browser dynamic import from both dev `http://localhost:*` and packaged app origins. After ready, handle requests by validating plugin id, version, and relative path against the boot-time runtime source snapshot. Reject absolute paths, `..`, symlinks escaping the plugin root, unknown ids, unknown versions, non-file roots, and every path outside the immutable package root. Never serve `work/<id>`, staging directories, index/cache files, or runtime credential files through this protocol. Return JavaScript MIME for `.js`, safe MIME types for CSS/images/assets, `X-Content-Type-Options: nosniff`, `Vary: Origin`, and CORS headers required for `import("pier-plugin://...")` to succeed.

Do not use `Access-Control-Allow-Origin: *`. Echo only an allowed origin: packaged app origin, Pier renderer file origin if needed, or dev `http://localhost:*` / `http://127.0.0.1:*` when `isDevRuntime()` is true. Reject or omit CORS for other initiators/origins and add tests for a disallowed origin. If Electron exposes `request.initiator`, validate it against the same allowlist as a defense-in-depth check.

- [ ] **Step 4: Update CSP**

Update `src/main/csp.ts` so both development and production CSP allow `pier-plugin:` for `script-src`, `style-src` when plugin CSS assets are used, and `img-src`/`font-src` for plugin assets. Preserve existing `pier-asset:` in `font-src` for bundled fonts while adding `pier-plugin:`. Do not add `http:`/`https:` script allowances for plugin code in either mode. Do not add `'unsafe-eval'` to production CSP under any circumstances. **Dev CSP intentionally retains `'unsafe-eval'`** (Vite HMR + react-refresh depend on it; see `src/main/csp.ts:20` and its inline comment); removing it breaks `pnpm dev`. This is a host-known dev-only exception, not a plugin-facing relaxation—**plugin package validation independently rejects `eval` / `new Function` usage regardless of runtime mode** (Task 2 `assertNoEvalUsage` in `validateManagedPluginPackage`), so an eval-using plugin never installs even in dev. CSP is defense-in-depth; package validation is the primary gate.

- [ ] **Step 5: Fix startup ordering**

Remove the static top-level `import { appCore } from "./app-core/app-core"` pattern from `src/main/index.ts`. Replace it with a deferred `createAppCore({ userDataDir, managedPlugins })` factory or dynamic import called only after `registerPluginAssetScheme()` and `configureAppIdentity()` have run. Move every top-level object that closes over `appCore`—window tracking, app lifecycle handlers, local-control registration, plugin host refresh, and shutdown cleanup—into the ready/bootstrap path after the factory returns. Initialize managed plugin paths and bundled seed install after userData is final and before `pluginHost.refresh()` or external runtime activation.

- [ ] **Step 6: Run protocol/startup tests**

Run:

```bash
pnpm vitest run tests/unit/main/plugin-asset-protocol.test.ts tests/unit/main/plugin-startup-order.test.ts
pnpm vitest run tests/unit/main/plugin-service.test.ts tests/unit/main/plugin-sources.test.ts
pnpm test:e2e -- tests/e2e/plugin-asset-protocol.spec.ts
```

Expected: unit tests PASS and the Electron/Playwright test creates a synthetic installed runtime source for `fixture.plugin@0.0.0` during the test, then confirms Chromium can dynamically import `pier-plugin://fixture.plugin/0.0.0/dist/renderer.js` from the renderer process. Do not depend on the Codex package or bundled seed in Task 4; those are introduced later.

- [ ] **Step 7: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): serve external plugin assets`

---

### Task 5: Plugin RPC bus and external main runtime

**Files:**
- Create: `src/main/plugins/plugin-rpc-bus.ts`
- Create: `src/main/plugins/external-main-runtime.ts`
- Modify: `src/main/plugins/plugin-context.ts`
- Modify: `src/main/plugins/runtime.ts`
- Modify: `src/plugins/api/main.ts`
- Modify: `src/main/plugins/host-api.ts`
- Create: `src/main/plugins/plugin-rpc-ipc.ts`
- Test: `tests/unit/main/plugin-rpc-bus.test.ts`
- Test: `tests/unit/main/plugin-rpc-ipc.test.ts`
- Test: `tests/unit/main/external-main-runtime.test.ts`
- Test: `tests/unit/app-core/local-control.test.ts`
- Test: `tests/unit/shared/command-schema-plugin-rpc-boundary.test.ts`

**Interfaces:**
- Produces `PluginRpcBus.handle(pluginId, method, handler)`, `invoke(request)`, `emit(pluginId, event, payload)`, `clearPlugin(pluginId)`.
- Produces `ExternalMainPluginRuntime.activate(entry)`, `flushAllBeforeQuit()`, and `disposeAll()`.
- Adds the full public `MainPluginContext` contract needed by external plugins: `plugin`, `paths.workDir`, `paths.dataDir`, `configuration`, `logger`, `rpc.handle`, `events.emit`, `lifecycle.onBeforeQuit`, `processEnv.resolveCliEnvironment()`, and plugin-scoped `secrets`. **The same enlarged `MainPluginContext` is delivered to existing builtin plugins (Git, Files, and the pre-Task-11 Codex)** — they are trusted code and gain the new facades without functional change, but every fake `MainPluginContext` stub in `tests/unit/**` and `tests/component/**` that currently only sets `{ configuration }` MUST be updated to include no-op shims for `plugin`/`paths`/`logger`/`rpc`/`events`/`lifecycle`/`processEnv`/`secrets` so the public type widening does not break their compile. Add a boundary test asserting `scanFileText("src/plugins/builtin/{git,files}/**/*.ts")` never references `context.rpc.handle` or `context.secrets` — builtins must not accidentally lean on external-plugin facades, because that would silently upgrade internal coupling into a de-facto internal RPC contract. v1 does not include main-side `commands.register`; user-visible commands are manifest-declared and renderer-action registered. v1 event flow is main plugin → renderer only; do not expose `events.on` unless a concrete event source and tests are added in a later design.
- Adds a private Codex-only migration adapter (concrete implementation shipped in Task 11a as `src/main/services/agent-accounts/legacy-migration-adapter.ts`), injected only when `plugin.id === "pier.codex"`, that exposes `legacyAgentAccountsStateFile`, `legacyAgentAccountsBaseDir`, `readLegacyAuthJson`, and `readLegacySecretsStoreEntry` outside the public `@pier/plugin-api` type surface. Task 5 wires the injection point in `external-main-runtime.ts`; Task 11a fills in the actual adapter implementation and consumer. A boundary test ensures no other `plugin.id` receives these fields.

- [ ] **Step 1: Write failing RPC bus tests**

Create `tests/unit/main/plugin-rpc-bus.test.ts` asserting:

```ts
const bus = createPluginRpcBus({ broadcast: vi.fn() });
bus.handle("pier.codex", "accounts.snapshot", async () => ({ accounts: [] }));
await expect(bus.invoke({ pluginId: "pier.codex", method: "accounts.snapshot", payload: null })).resolves.toEqual({ ok: true, data: { accounts: [] } });
await expect(bus.invoke({ pluginId: "pier.codex", method: "missing", payload: null })).resolves.toEqual({ ok: false, error: { code: "not_found", message: "No RPC handler registered for pier.codex:missing" } });
bus.emit("pier.codex", "accounts.changed", { accounts: [] });
expect(broadcast).toHaveBeenCalledWith({ pluginId: "pier.codex", event: "accounts.changed", payload: { accounts: [] } });
```

- [ ] **Step 2: Write failing external runtime test**

Create `tests/unit/main/external-main-runtime.test.ts` with a temporary module exporting:

```ts
export const plugin = {
  id: "pier.codex",
  activate(context) {
    context.rpc.handle("accounts.snapshot", async () => ({ accounts: [] }));
    context.lifecycle.onBeforeQuit(async () => {
      globalThis.__externalRuntimeTestFlushes.push("pier.codex");
    });
    return () => context.logger.info("disposed");
  },
};
```

Assert runtime activates the module, registers the handler, supplies `context.plugin.id`, `context.paths.workDir`, `context.logger`, encrypted-only `context.secrets`, and `context.processEnv.resolveCliEnvironment`, awaits a registered `onBeforeQuit` flush callback from `flushAllBeforeQuit()`, calls disposer on `disposeAll()`, and calls `managedPlugins.recordActivationResult({ pluginId, version, phase: "main", ok })` on success/failure. Add a timeout test where a plugin `onBeforeQuit` promise never resolves; `flushAllBeforeQuit()` must return after `PLUGIN_BEFORE_QUIT_TIMEOUT_MS`, record diagnostics, and continue flushing other plugins. Add a main lifecycle test that simulates Electron `before-quit`: first event calls `preventDefault()`, awaits `flushAllBeforeQuit()`, sets an internal `pluginFlushCompletedForQuit` flag, calls `app.quit()` once, and the second `before-quit` passes without preventing default; `will-quit` must not await plugin callbacks. Add a separate Codex-only test that the private migration adapter is present for `pier.codex` and absent for another external plugin. Add a secrets test where the underlying host `SecretsStore` reports plaintext fallback / unavailable safeStorage and assert plugin `context.secrets.set("account:a:authJson", ...)` rejects with a diagnostic instead of writing plaintext.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/main/plugin-rpc-bus.test.ts tests/unit/main/external-main-runtime.test.ts`

Expected: FAIL because files do not exist.

- [ ] **Step 4: Implement RPC bus**

Implement handler maps keyed by `${pluginId}:${method}`. Wrap handler exceptions into `{ ok: false, error: { code, message, details?, diagnosticId? } }`; use stable codes such as `not_found`, `invalid_request`, and `internal_error`. Broadcast event payloads on `PIER_BROADCAST.PLUGIN_RPC_EVENT` using the app window broadcaster already used by foreground activity/plugin stores. Because events are delivered to all Pier windows before renderer-side pluginId filtering, event payloads must never contain auth tokens, raw `auth.json`, safeStorage ciphertext, or other secret material; add a governance test for known Codex events.

- [ ] **Step 5: Implement external main runtime**

Implement dynamic `import(pathToFileURL(entry.mainEntryPath).href)` for local file entries only, validate exported `plugin.id`, call `activate(context)`, store disposer by plugin id, clear RPC handlers on dispose, and report main activation success/failure to `recordActivationResult`. Keep builtin runtime unchanged and compose both in `src/main/plugins/runtime.ts`. Add a lifecycle registry so plugins can register awaited before-quit flush callbacks. `flushAllBeforeQuit()` must wrap each callback in a timeout such as `PLUGIN_BEFORE_QUIT_TIMEOUT_MS = 5000`; timeout or rejection records a diagnostic and does not block other callbacks or app quit. Wire this into `src/main/index.ts` / app lifecycle: the first Electron `before-quit` event prevents default, awaits `flushAllBeforeQuit()`, then sets a flag and calls `app.quit()` again; the second `before-quit` sees the flag and does not prevent default. `will-quit` may call quick disposal/final cleanup only and must not wait on plugin callbacks. Add `context.processEnv.resolveCliEnvironment()` that delegates to `ProcessEnvironmentService.resolve({ source: "plugin", ... }).env` rather than the old Codex-specific `AgentDetectionService.ensurePath()` void hook, so GUI-launched plugin subprocesses receive a concrete env object containing PATH. Add `context.secrets` as a key-scoped encrypted-only wrapper over the host secret persistence: external plugins can read/write only keys prefixed internally with their plugin id, e.g. `plugin:pier.codex:<key>`, and the raw prefix is not exposed to plugin code. Do not use the existing plaintext fallback path from `src/main/state/secrets-store.ts` for plugin secrets; if safeStorage encryption is unavailable, decrypt fails, or encryption write fails, plugin secrets operations reject and add diagnostics. Non-sensitive plugin state belongs in `context.paths.workDir`.

- [ ] **Step 6: Wire renderer-only plugin RPC IPC**

Register a main-process IPC handler for `PIER.PLUGIN_RPC_INVOKE` in `src/main/plugins/plugin-rpc-ipc.ts` that dispatches to `pluginRpcBus.invoke({ pluginId, method, payload })` only for renderer `webContents` owned by Pier windows. Do not route plugin RPC through the public `PierCommand` command router, CLI local-control, or capability-only command authorization. Add `tests/unit/main/plugin-rpc-ipc.test.ts` for the dedicated IPC handler and ownership check, `tests/unit/shared/command-schema-plugin-rpc-boundary.test.ts` asserting a raw `pluginRpc.invoke` PierCommand is rejected by the shared command schema, and extend `tests/unit/app-core/local-control.test.ts` asserting local-control cannot invoke plugin RPC. Renderer preload can invoke only the dedicated IPC handler. Do not expose cross-plugin method calls in `@pier/plugin-api`; renderer plugin contexts receive a scoped invoker that supplies their own plugin id. Document that this is a same-realm trusted-code discipline boundary, not a sandbox against malicious renderer code.

- [ ] **Step 7: Run runtime tests**

Run:

```bash
pnpm vitest run tests/unit/main/plugin-rpc-bus.test.ts tests/unit/main/plugin-rpc-ipc.test.ts tests/unit/main/external-main-runtime.test.ts tests/unit/main/plugin-runtime.test.ts tests/unit/main/plugin-context.test.ts tests/unit/app-core/local-control.test.ts tests/unit/shared/command-schema-plugin-rpc-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): load external main plugins`

---

### Task 6: Renderer external plugin loading and shared React bridge

**Files:**
- Create: `packages/plugin-api/package.json`
- Create: `packages/plugin-api/src/main.ts`
- Create: `packages/plugin-api/src/renderer.ts`
- Create: `packages/plugin-api/src/react.ts`
- Create: `packages/plugin-api/src/jsx-runtime.ts`
- Create: `packages/plugin-api/src/jsx-dev-runtime.ts`
- Create: `packages/plugin-api/src/react-dom-client.ts`
- Create: `packages/plugin-api/src/build-preset.ts`
- Modify: `pnpm-lock.yaml`
- Create: `src/renderer/lib/plugins/plugin-shared-runtime.ts`
- Create: `src/renderer/lib/plugins/external-renderer-loader.ts`
- Create: `src/renderer/lib/plugins/external-plugin-context.ts`
- Create: `src/renderer/components/workspace/plugin-panel-unavailable.tsx`
- Modify: `src/renderer/lib/plugins/runtime.ts`
- Modify: `src/renderer/lib/plugins/bootstrap.ts`
- Create: `src/preload/plugin-rpc-api.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/unit/renderer/external-renderer-runtime.test.ts`
- Test: `tests/unit/renderer/plugin-rpc-context.test.ts`

**Interfaces:**
- Produces plugin API package exports for external plugins.
- Produces React shared shims for `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and `react-dom/client` aliases.
- Produces `loadExternalRendererPlugin(entry)` and `installPluginSharedRuntime()`.
- Produces a generic plugin panel unavailable fallback used when dockview restores a plugin panel whose plugin contribution is disabled, uninstalled, failed, or not registered yet.
- Adds renderer `context.rpc.invoke(method, payload)` and `context.rpc.on(event, callback)`.
- Reports renderer activation success/failure back to the main install service through a host-internal activation-result bridge.

- [ ] **Step 1: Write failing renderer tests**

Create tests that stub the host-internal preload RPC bridge, emit `pier://plugin-rpc:event`, and assert plugin code receives only scoped APIs:

```ts
await context.rpc.invoke("accounts.snapshot", null);
expect(hostInternalPluginRpcInvoke).toHaveBeenCalledWith({ pluginId: "pier.codex", method: "accounts.snapshot", payload: null });
expect(Object.keys(context.rpc)).toEqual(["invoke", "on"]);
expect("pluginId" in context.rpc).toBe(false);
context.rpc.on("accounts.changed", callback);
window.dispatchEvent(new CustomEvent("pier://plugin-rpc:event", { detail: { pluginId: "pier.codex", event: "accounts.changed", payload: { accounts: [] } } }));
window.dispatchEvent(new CustomEvent("pier://plugin-rpc:event", { detail: { pluginId: "pier.other", event: "accounts.changed", payload: { accounts: ["wrong"] } } }));
expect(callback).toHaveBeenCalledTimes(1);
expect(callback).toHaveBeenCalledWith({ accounts: [] });
await expect(context.rpc.invoke("accounts.snapshot", null)).resolves.toEqual({ accounts: [] });
hostInternalPluginRpcInvoke.mockResolvedValueOnce({ ok: false, error: { code: "internal_error", message: "boom", diagnosticId: "diag-1" } });
await expect(context.rpc.invoke("accounts.snapshot", null)).rejects.toThrow("boom");
```

Create a mocked external renderer module exporting `plugin.activate(context)` and assert runtime calls it for registry entries with runtime kind `external`, then reports `{ pluginId, version, phase: "renderer", ok: true, windowId }` through the host-internal activation bridge. Add a failure test where dynamic import or `activate` throws and assert it reports `{ ok: false, diagnosticId }` and renders fallback UI. Add a dockview restore test that references a plugin panel contribution before registration, after plugin disable/uninstall/failure, and during delayed external registration; it should render `Plugin panel unavailable` or loading fallback without dropping the panel or throwing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/renderer/external-renderer-runtime.test.ts tests/unit/renderer/plugin-rpc-context.test.ts`

Expected: FAIL because loader and RPC context are absent.

- [ ] **Step 3: Add plugin API package**

Create `packages/plugin-api` with public external plugin types. For renderer types, do not re-export the current host `RendererPluginContext` wholesale because it still includes the legacy `accounts` facade until Task 11; instead define an explicit account-free `ExternalRendererPluginContext` adapter type with `rpc`, panels, dashboard widgets, dialogs, files/git/worktrees, and other allowed facades. Add `PluginRpcError = { code: string; message: string; details?: unknown; diagnosticId?: string }`. Add shims that read `globalThis.__PIER_PLUGIN_SHARED__`: `src/react.ts` for classic React APIs, `src/jsx-runtime.ts` for `jsx`/`jsxs`/`Fragment`, `src/jsx-dev-runtime.ts` for dev JSX runtime, and `src/react-dom-client.ts` for host-approved renderer helpers if a plugin needs them. Add `src/build-preset.ts` exporting Vite/Rollup alias config that maps `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and `react-dom/client` to these shim modules. External plugins must build with this package and must not import `src/*`.

Run the Task 0 boundary tests immediately after creating `packages/plugin-api`, and keep them in this task's verification so `packages/plugin-api/src` never imports `src/main`, `src/renderer`, or builtin plugin implementations.

- [ ] **Step 4: Implement shared runtime bridge**

In `plugin-shared-runtime.ts`, assign:

```ts
// packages/plugin-api/src/react.ts — completeness is enforced by a fixture test
const shared = (globalThis as { __PIER_PLUGIN_SHARED__?: PierPluginSharedRuntime }).__PIER_PLUGIN_SHARED__;
if (!shared) throw new Error("Pier shared runtime not installed before plugin loaded");
const { React, ReactDOMClient } = shared;
export default React;
export const {
  useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer,
  useLayoutEffect, useSyncExternalStore, useTransition, useDeferredValue,
  useOptimistic, useId, use,
  createElement, createContext, createRef, forwardRef, lazy, memo,
  startTransition, Suspense, StrictMode, Profiler, Fragment,
  cloneElement, Children, isValidElement, PureComponent, Component, version,
} = React;
// packages/plugin-api/src/react-dom-client.ts
export const { createRoot, hydrateRoot } = ReactDOMClient;
```

In `plugin-shared-runtime.ts`, populate the shared runtime object with the full React and react-dom/client namespaces (not only JSX helpers), so shim files above can destructure without gaps:

```ts
globalThis.__PIER_PLUGIN_SHARED__ = {
  React,                              // full react namespace, not just Fragment/createElement
  ReactDOMClient,                     // full react-dom/client namespace
  jsxRuntime: { jsx, jsxs, Fragment },      // for packages/plugin-api/src/jsx-runtime.ts
  jsxDevRuntime: { jsxDEV, Fragment },      // for packages/plugin-api/src/jsx-dev-runtime.ts
};
```

Call `installPluginSharedRuntime()` before loading external renderer entries. Keep React singleton ownership in the host. Add a fixture plugin built with TSX automatic runtime and the plugin build preset, then assert the emitted `dist/renderer.js` contains no bare imports matching `from "react"`, `from "react/jsx-runtime"`, `from "react-dom"`, `from "@pier/ui"`, or `from "lucide-react"`, and can be dynamically imported after the shared runtime is installed.

Add a completeness fixture test at `tests/unit/plugins/plugin-api-react-shim-completeness.test.ts` that imports `packages/plugin-api/src/react.ts` and asserts its named exports are a superset of `Object.keys(require("react"))` (minus internal `__CLIENT_INTERNALS_*` symbols). This catches React upgrades that add a new hook (e.g. React 20's future additions) and would otherwise silently leave the shim missing that export. Same fixture for `react-dom-client.ts` vs `Object.keys(require("react-dom/client"))`.

- [ ] **Step 5: Implement external renderer loader**

Dynamic import `entry.runtime.rendererEntryUrl`, validate `module.plugin.id`, call `activate(context)`, store disposer, and report renderer activation success/failure through a host-internal preload bridge to main `recordActivationResult`. If main activation for the effective plugin version has already failed, do not import the renderer entry; render the unavailable fallback and report/retain diagnostics so the current process never mixes a failed main version with a renderer UI from another version. Include the effective plugin version and a stable renderer window/plugin-instance id so install-service can deduplicate multi-window reports. Use ErrorBoundary for contributed panels/widgets through existing registry wrappers. Wire dockview plugin panel restoration so missing/failed/unregistered plugin panel contributions render `PluginPanelUnavailable` instead of an unknown component; when a delayed external registration arrives, normal rendering can replace the fallback without losing panel params.

- [ ] **Step 6: Implement renderer RPC context and preload bridge**

Expose host-internal preload functions used only by Pier's renderer plugin runtime, not by `@pier/plugin-api`: one for scoped plugin RPC invoke and one for renderer activation result reporting. The plugin runtime creates `createRendererPluginContext(pluginId)`, whose `rpc.invoke(method, payload)` injects the plugin id, unwraps `{ ok: true, data }` to `data`, converts `{ ok: false, error }` into a thrown structured error, and whose `rpc.on(event, callback)` filters by plugin id and event name. Forward `PIER_BROADCAST.PLUGIN_RPC_EVENT` into renderer subscribers. Add a test that `packages/plugin-api/src/renderer.ts` exports no `accounts` member and no raw `pluginRpc.invoke({ pluginId })` public type. Leave `src/plugins/api/renderer.ts`, `src/renderer/lib/plugins/host-context.ts`, and `src/renderer/lib/plugins/host-accounts-context.ts` unchanged until Task 11, because the builtin Codex renderer still depends on them before migration.

- [ ] **Step 7: Run renderer tests**

Run:

```bash
pnpm vitest run tests/unit/renderer/external-renderer-runtime.test.ts tests/unit/renderer/plugin-rpc-context.test.ts tests/unit/renderer/plugin-bootstrap.test.ts
pnpm vitest run tests/unit/plugins/plugin-api-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): load external renderer plugins`

---

### Task 7: Settings plugin management UI

**Files:**
- Modify: `src/renderer/stores/plugin-registry.store.ts`
- Create: `src/renderer/pages/settings/components/managed-plugins-section.tsx`
- Create: `src/renderer/pages/settings/components/managed-plugin-card.tsx`
- Modify: `src/renderer/pages/settings/components/plugins-section.tsx`
- Modify: `src/renderer/pages/settings/components/plugin-configuration-section.tsx`
- Modify: `src/preload/index.ts` (add `window.pier.app.relaunch()` facade that calls the `app.relaunch` PierCommand added in Task 1)
- Modify: `src/main/app-core/command-router.ts` (dispatch `app.relaunch` → `app.relaunch(); app.quit();` after `flushAllBeforeQuit()` completes; do NOT skip flush)
- Test: `tests/component/managed-plugins-section.test.tsx`

**Interfaces:**
- Consumes `window.pier.managedPlugins.list()` catalog snapshots plus management methods, not runtime `window.pier.plugins.list()`, because never-installed official plugins do not appear in the runtime registry.
- Produces UI actions: Check Updates, Install, Update, Roll Back, Uninstall, Enable, Disable, Set Dev Override, Clear Dev Override. Dev override actions are rendered only in dev/test runtime.

- [ ] **Step 1: Write failing component tests**

Create `tests/component/managed-plugins-section.test.tsx` asserting the page renders:

```ts
expect(screen.getByText("Codex")).toBeInTheDocument();
expect(screen.getByText("Official")).toBeInTheDocument();
expect(screen.getByText("Update available")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Update" }));
expect(window.pier.managedPlugins.update).toHaveBeenCalledWith("pier.codex");
await user.click(screen.getByRole("button", { name: "Disable" }));
expect(window.pier.managedPlugins.disable).toHaveBeenCalledWith("pier.codex");
```

Also assert dev override badge text `Dev Override`, restart notice text `Restart Pier to use the installed plugin version.`, trusted-code warning text `Official plugins are managed trusted code and are not sandboxed.`, and (new) that a **Restart Pier Now** button appears when any row has `pendingRestart !== null`. Clicking it must call `window.pier.app.relaunch()` (Task 7 Step 3 registers this preload facade). Also assert that a **Restore Bundled Version** secondary button appears next to Install for rows where `catalog.offlineRestoreAvailable === true` (the row has a tombstone AND bundled seed matches a previously seen official hash). Clicking it calls `window.pier.managedPlugins.install(id)` — the install service internally routes to `restoreFromBundledSeed` when the official index is unreachable. Add a production-mode test asserting Set Dev Override / Clear Dev Override controls are absent and a denied operation result is shown as diagnostics if returned from the preload facade. Add a rate-limit test asserting that when `checkUpdates()` returns diagnostic `{ code: "rate_limited", nextAllowedAt }`, the UI shows the "Recently checked; try again in Ns" toast rather than an error dialog.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/managed-plugins-section.test.tsx`

Expected: FAIL because current plugin settings UI does not expose managed plugin operations.

- [ ] **Step 3: Update store and UI**

Add managed catalog state fields: desired version/enabled/source, effective runtime version/enabled/source, `lastKnownGoodVersion: string | null`, `offlineRestoreAvailable: boolean`, pending update, pending rollback, pending restart operation, source badge, dev override path, dev override allowed flag, tombstone/uninstalled state, operation log summary/last result, and diagnostics. Render Installed and Available sections from `window.pier.managedPlugins.list()`. Current-session contribution visibility must continue to follow the effective runtime snapshot until restart, while the settings UI shows desired next-start state and a `Restart required` badge when desired/effective diverge. Add a page-level **Restart Pier Now** button visible whenever any row has a non-null `pendingRestart`; the button calls a new preload facade `window.pier.app.relaunch()` (main-side handler: `app.relaunch(); app.quit();`, gated by a new `app.relaunch` PierCommand with `allowedClientKinds: ["desktop-renderer"]` and `capabilities: ["window:control"]`). Add per-row **Restore Bundled Version** secondary button, shown only when `catalog.offlineRestoreAvailable === true`, next to Install. When the official index is unreachable and the user clicks Install, surface an inline notice pointing at Restore Bundled Version as the offline fallback. When `checkUpdates()` diagnostic includes `{ code: "rate_limited" }`, render a non-error toast "Recently checked; try again in Ns" rather than a failure dialog. Display a visible trust-boundary notice for external plugins: `Official plugins are managed trusted code and are not sandboxed.` Display stronger local-code warning when dev override is enabled. Hide dev override controls when `devOverrideAllowed` is false. If activation diagnostics identify a failed desired version and a last-known-good version exists, render a Roll Back action only when the catalog says the target is installed, hash-verified, and data-schema compatible; the action calls `window.pier.managedPlugins.rollback(id, version)`. Use `showAppConfirm` for uninstall, rollback, and disable destructive confirmations with `size: "sm"` and `intent: "destructive"`. Use `showAppAlert` for install/update/rollback errors.

- [ ] **Step 4: Run UI tests**

Run:

```bash
pnpm vitest run tests/component/managed-plugins-section.test.tsx tests/unit/renderer/app-dialog-governance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(plugins): add managed plugin settings UI`

---

### Task 8: Official Codex external plugin package scaffold

**Files:**
- Create: `packages/plugin-codex/package.json`
- Create: `packages/plugin-codex/plugin.json`
- Create: `packages/plugin-codex/tsconfig.json`
- Create: `packages/plugin-codex/vite.config.ts`
- Create: `packages/plugin-codex/src/main/index.ts`
- Create: `packages/plugin-codex/src/renderer/index.tsx`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Test: `tests/unit/plugins/codex-plugin-package.test.ts`

**Interfaces:**
- Produces source package metadata with `packages/plugin-codex/package.json` declaring `"type": "module"` and a generated seed package with `dist-package/package.json`, `dist/main.js`, `dist/renderer.js`, and `plugin.json`.
- Main plugin exports `plugin: MainPluginModule` with id `pier.codex`.
- Renderer plugin exports `plugin: RendererPluginModule` with id `pier.codex`.

- [ ] **Step 1: Write failing package test**

Create `tests/unit/plugins/codex-plugin-package.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { managedPluginPackageManifestSchema } from "@shared/contracts/managed-plugin.ts";

describe("pier.codex plugin package", () => {
  it("has a valid managed plugin manifest", async () => {
    const packageJson = JSON.parse(await readFile("packages/plugin-codex/package.json", "utf8"));
    expect(packageJson).toMatchObject({ name: "@pier/plugin-codex", type: "module" });
    const manifest = JSON.parse(await readFile("packages/plugin-codex/plugin.json", "utf8"));
    expect(managedPluginPackageManifestSchema.parse(manifest)).toMatchObject({ id: "pier.codex", main: "dist/main.js", renderer: "dist/renderer.js" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/plugins/codex-plugin-package.test.ts`

Expected: FAIL because `packages/plugin-codex/plugin.json` does not exist.

- [ ] **Step 3: Create package scaffold**

Create `packages/plugin-codex/package.json` with `"type": "module"` and build scripts, then create `plugin.json` declaring `pier.codex`, commands `pier.codex.addAccount`, `pier.codex.switchAccount`, `pier.codex.refreshUsage`, configuration `pier.codex.confirmSwitch`, and dashboard widget `pier.codex.accounts`. `src/main/index.ts` registers a temporary RPC handler returning an empty snapshot. `src/renderer/index.tsx` registers a dashboard widget that renders `Codex accounts loading`. Add `.gitignore` entries for generated package outputs such as `packages/*/dist/` and `packages/*/dist-package/` so seed builds do not create untracked artifacts.

- [ ] **Step 4: Add build script**

Add root scripts without replacing the existing native predev guard. Read the current `package.json` script values first, then chain `pnpm plugin:codex:build` before the existing `node ./scripts/dev-profile.mjs predev` command:

```json
"plugin:codex:build": "pnpm --filter @pier/plugin-codex build",
"predev": "pnpm plugin:codex:build && <existing predev command>",
"preelectron:dev": "pnpm plugin:codex:build && <existing preelectron:dev/predev guard command>",
"typecheck:packages": "pnpm --filter @pier/plugin-api typecheck && pnpm --filter @pier/plugin-codex typecheck"
```

Update root `typecheck` or `check` so package typechecks run in CI, either by including package project references in `tsconfig.json` or by invoking `pnpm typecheck:packages` from `pnpm check`. Make both `pnpm dev` and `pnpm check` standalone for this feature by running `pnpm plugin:codex:build` before startup/tests that inspect `dist-package`; preserve the existing native predev guard by chaining rather than replacing it, so clean dev startups still have the default-enabled bundled Codex seed. Ensure plugin build uses `@pier/plugin-api/build-preset` so React/JSX runtime imports are aliased to host shared-runtime shims, `@pier/ui` and `lucide-react` are either bundled with React imports rewritten through those aliases or served through an explicit host shim. Ensure the main plugin bundle is self-contained for installation under `userData/plugins/installed/<id>/<version>` / app resources: `dist-package/dist/main.js` may contain only relative imports and `node:` builtins; v1 `ELECTRON_MAIN_IMPORT_ALLOWLIST` is empty, so `electron` imports fail package validation unless a later design expands the allowlist. Runtime dependencies such as `write-file-atomic` must be bundled into the file. Use one exact seed layout: `packages/plugin-codex/dist-package/package.json` with `{ "type": "module" }`, `packages/plugin-codex/dist-package/plugin.json`, `packages/plugin-codex/dist-package/dist/main.js`, `packages/plugin-codex/dist-package/dist/renderer.js`, and `packages/plugin-codex/dist-package/dist/assets/**`. Do not rewrite manifest entry paths. Add build assertions that both `dist-package/dist/renderer.js` and `dist-package/dist/main.js` have no unresolved bare module imports, and that `validateManagedPluginPackage({ packageDir: "packages/plugin-codex/dist-package", expectedId: "pier.codex", expectedVersion })` passes. Run the Task 0 boundary tests after adding `packages/plugin-codex` so app `src/**` cannot statically import `packages/plugin-codex/src/**`.

**Recommended Codex plugin iteration flow** (add as a Codex plugin dev doc note in `packages/plugin-codex/README.md` or the design's §6.5):

```bash
# Terminal 1 — watch-rebuild plugin bundle on source change
pnpm --filter @pier/plugin-codex build --watch

# Terminal 2 — Pier main app
pnpm dev
# One-time: Settings → Plugins → Install Dev Plugin… → pick packages/plugin-codex/dist-package
# Subsequent: edit plugin source → watcher rebuilds → restart Pier (external plugins are next-start loaded; v1 has no hot reload)
```

`predev` already ensures a fresh Codex seed at cold start; the watcher just spares developers from running `pnpm plugin:codex:build` between edits. Do not add HMR/watch loading in v1 — the plan design (§6.4) explicitly limits dev override to prebuilt directories.

- [ ] **Step 5: Run package tests and build**

Run:

```bash
pnpm vitest run tests/unit/plugins/codex-plugin-package.test.ts
pnpm plugin:codex:build
```

Expected: PASS and build output contains `dist-package/package.json`, `dist-package/plugin.json`, `dist-package/dist/main.js`, and `dist-package/dist/renderer.js`.

- [ ] **Step 6: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(codex): add external plugin package scaffold`

---

### Task 9: Move Codex account service into the plugin

**Files:**
- Create: `packages/plugin-codex/src/main/accounts-service.ts`
- Create: `packages/plugin-codex/src/main/codex-provider.ts`
- Create: `packages/plugin-codex/src/main/codex-usage.ts`
- Create: `packages/plugin-codex/src/main/identity.ts`
- Create: `packages/plugin-codex/src/main/login-error.ts`
- Create: `packages/plugin-codex/src/main/types.ts`
- Create: `packages/plugin-codex/src/shared/accounts.ts`
- Modify: `packages/plugin-codex/src/main/index.ts`
- Test: `tests/unit/plugins/codex-plugin-migration.test.ts`

**Interfaces:**
- Produces plugin-local account DTOs in `packages/plugin-codex/src/shared/accounts.ts`: `CodexAccountStatus = "active" | "available" | "login-pending" | "error"`, `CodexAccountSummary = { id: string; label: string; status: CodexAccountStatus; usage?: CodexUsageSnapshot | null; error?: string | null }`, `CodexAccountsSnapshot = { accounts: CodexAccountSummary[]; activeAccountId: string | null; login: CodexLoginState | null; revision: number; schemaVersion: number }`, persisted metadata `CodexAccountsState = { schemaVersion: number; revision: number; activeAccountId: string | null; accounts: Array<{ id: string; label: string; status: CodexAccountStatus; error?: string | null }> }`, and RPC payloads `AddAccountPayload = { label?: string }`, `SelectAccountPayload = { accountId: string }`, `RemoveAccountPayload = { accountId: string }`.
- Produces RPC methods `accounts.snapshot`, `accounts.add`, `accounts.cancelLogin`, `accounts.select`, `accounts.remove`, `accounts.refreshUsage`, `accounts.adoptCurrent` using those plugin-local DTOs.
- Emits event `accounts.changed` with `CodexAccountsSnapshot`.
- Stores non-sensitive account metadata under `context.paths.workDir`, stores `auth.json` content in encrypted-only plugin-scoped `context.secrets`, materializes runtime `auth.json` files only with `0600`, and exposes an awaited `flush()` used by `context.lifecycle.onBeforeQuit`.
- Owns account data schema migration: read only supported `schemaVersion` values, write backup before schema upgrades, and update the host-readable `work/pier.codex/.pier-plugin-data-schemas.json` marker used by managed rollback checks.
- Uses `context.processEnv.resolveCliEnvironment()` before spawning `codex login` or `codex app-server` so GUI launches inherit the same PATH resolution as the current core service.

- [ ] **Step 1: Write failing Codex plugin service tests**

Create `tests/unit/plugins/codex-plugin-migration.test.ts` asserting:

```ts
const fakeUsageClient = createFakeCodexUsageClient();
const fakeAppServer = createFakeCodexAppServer();
const service = createCodexAccountsService({ workDir, realCodexHome, secrets: fakePluginSecrets, spawnCodexLogin: fakeLogin, usageClient: fakeUsageClient, appServer: fakeAppServer, resolveCliEnvironment: fakeResolveCliEnvironment, now: () => 1 });
await service.init();
expect(await service.snapshot()).toMatchObject({ accounts: [], revision: 1 });
await service.adoptCurrent();
expect(await service.snapshot()).toMatchObject({ activeAccountId: expect.any(String) });
await service.refreshUsage();
expect(fakeUsageClient.requests).toEqual([expect.objectContaining({ activeOnly: true, env: expect.objectContaining({ PATH: expect.stringContaining("codex-bin") }) })]);
await service.add({ label: "Personal" });
expect(fakeLogin.env).toMatchObject({ CODEX_HOME: expect.any(String), PATH: expect.stringContaining("codex-bin") });
await service.flush();
expect(await readFile(join(workDir, "accounts.json"), "utf8")).toContain("Personal");
expect(await readFile(join(workDir, "accounts.json"), "utf8")).not.toContain("refresh_token");
expect(JSON.parse(await readFile(join(workDir, "accounts.json"), "utf8"))).toMatchObject({ schemaVersion: 1 });
expect(fakePluginSecrets.setCalls).toEqual(expect.arrayContaining([expect.objectContaining({ key: expect.stringMatching(/^account:.+:authJson$/) })]));
expect(fakePluginSecrets.setCalls[0]).toMatchObject({ requireEncryption: true });
expect(await fileMode(join(fakeLogin.runtimeHome, "auth.json"))).toBe("0600");
expect(fakeAppServer.env).toMatchObject({ CODEX_HOME: expect.any(String), PATH: expect.stringContaining("codex-bin") });
expect(classifyLoginError(new Error("AbortError"), { wasCancelled: true })).toMatchObject({ errorState: "cancelled", failure: null });
await service.dispose();
expect(fakeLogin.cancelled).toBe(true);
```

Add tests for fail-closed secrets and schema rollback: when `fakePluginSecrets` reports encryption unavailable, `adoptCurrent()` and `add()` must reject or produce an account error without writing token content to `accounts.json`; when loading an older supported schema, the service writes `accounts.json.backup-before-schema-<from>-to-<to>` before upgrading and updates `.pier-plugin-data-schemas.json`; when loading an unsupported newer schema, the service refuses to start and reports a diagnostic instead of rewriting data.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/plugins/codex-plugin-migration.test.ts`

Expected: FAIL because Codex plugin account service files do not exist.

- [ ] **Step 3: Move service code**

Copy logic from `src/main/services/agent-accounts/*` into focused files under `packages/plugin-codex/src/main/*`, including `login-error.ts`, changing paths to use `context.paths.workDir` plus encrypted-only plugin-scoped `context.secrets`. Split the large current service while moving it: account metadata persistence, encrypted credential persistence, schema migration, login process handling, real Codex-home watcher, usage polling, and mutation queue each get focused modules so no package source file exceeds the project hard cap. Move snapshot/account/usage DTOs into plugin-local `packages/plugin-codex/src/shared/accounts.ts` and use those types from both Codex main and renderer; do not import `@shared/contracts/agent-accounts` from the plugin. Populate `label` from explicit add payload when provided, otherwise from migrated legacy account label/name if present, otherwise a stable fallback such as `Codex <shortId>`. Populate `status` as `active` for `activeAccountId`, `available` for other usable accounts, `login-pending` for in-flight login entries, and `error` when the copied service has an account/login error state. Increment `revision` on every state mutation and include it in every snapshot/event. Keep existing semantics: adopt real `~/.codex/auth.json` by reading it into `context.secrets` with `requireEncryption: true`, add account through `codex login` with managed runtime `CODEX_HOME`, add without switching, switch by syncing current account then materializing target account from `context.secrets`, watch real Codex home drift, active-account-only usage polling, serial mutation queue, cancel login, dispose watcher/timer/login. Runtime `auth.json` files are cache/materialization artifacts only: write them with `0600`, never include token content in `accounts.json` or logs, and recreate them from `context.secrets` as needed. If encrypted secrets are unavailable, do not fall back to plaintext: block adopt/add/sync of auth content and surface a diagnostic. Replace injected core `ensureUsageEnv` with `context.processEnv.resolveCliEnvironment()` and preserve the copied `classifyLoginError(error, context)` contract returning `{ errorState, failure }`.

Persist `accounts.json` with `schemaVersion`. On startup, if the file has an older supported schema, first write a backup such as `accounts.json.backup-before-schema-1-to-2`, then atomically migrate, increment `revision`, and atomically update `work/pier.codex/.pier-plugin-data-schemas.json` with `{ schemas: { "codex.accounts": { version: <schemaVersion>, updatedByPluginVersion } } }`. If `accounts.json` exists but the schema marker is missing, revalidate metadata and encrypted credentials, then repair the marker before `pier.codex` reports activation success; if repair fails, activation fails and `lastKnownGoodVersion` is not promoted. If the file has a newer unsupported schema, refuse to mutate it and report diagnostics so the managed plugin rollback path can prevent launching an incompatible older plugin. Do not expose or import a Codex-private compatibility helper from install-service; compatibility is decided from the generic marker file plus each package manifest's `dataSchemas` declaration.

For subprocesses, `codex login` must receive `{ ...resolved.env, CODEX_HOME: runtimeHome }`; `codex app-server` must receive the resolved env and the active account home/materialized credentials it needs. Tests must assert both paths receive the resolved `PATH`, not just usage polling, and that every materialized `auth.json` in runtime homes or real Codex home is written with `0600`.

- [ ] **Step 4: Register RPC handlers in plugin main**

In `packages/plugin-codex/src/main/index.ts`:

```ts
context.rpc.handle("accounts.snapshot", () => service.snapshot());
context.rpc.handle("accounts.add", (payload) => service.add(payload));
context.rpc.handle("accounts.cancelLogin", () => service.cancelLogin());
context.rpc.handle("accounts.select", (payload) => service.select(payload));
context.rpc.handle("accounts.remove", (payload) => service.remove(payload));
context.rpc.handle("accounts.refreshUsage", () => service.refreshUsage());
context.rpc.handle("accounts.adoptCurrent", () => service.adoptCurrent());
service.onChanged((snapshot) => context.events.emit("accounts.changed", snapshot));
context.lifecycle.onBeforeQuit(() => service.flush());
```

- [ ] **Step 5: Run Codex service tests**

Run:

```bash
pnpm vitest run tests/unit/plugins/codex-plugin-migration.test.ts
pnpm plugin:codex:build
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(codex): move account service into plugin`

---

### Task 10: Move Codex renderer widget/actions to plugin RPC

**Files:**
- Create: `packages/plugin-codex/src/renderer/accounts-widget.tsx`
- Create: `packages/plugin-codex/src/renderer/account-actions.ts`
- Create: `packages/plugin-codex/src/renderer/usage-meter.tsx`
- Modify: `packages/plugin-codex/src/renderer/index.tsx`
- Test: `tests/unit/plugins/codex-plugin-renderer.test.tsx`

**Interfaces:**
- Consumes `context.rpc.invoke` and `context.rpc.on`.
- Produces dashboard widget `pier.codex.accounts` and commands `pier.codex.addAccount`, `pier.codex.switchAccount`, `pier.codex.refreshUsage`.
- Produces a plugin-private renderer account store/hook that subscribes before initial snapshot load and applies snapshots/events by monotonic `revision`.

- [ ] **Step 1: Write failing renderer plugin tests**

Create `tests/unit/plugins/codex-plugin-renderer.test.tsx` asserting:

```ts
render(<AccountsWidget context={fakeContext} />);
expect(fakeContext.rpc.on).toHaveBeenCalledWith("accounts.changed", expect.any(Function));
await waitFor(() => expect(fakeContext.rpc.invoke).toHaveBeenCalledWith("accounts.snapshot", null));
fakeContext.emit("accounts.changed", { accounts: [{ id: "a", label: "Work", status: "active" }], activeAccountId: "a", login: null, revision: 2 });
expect(await screen.findByText("Work")).toBeInTheDocument();
fakeContext.resolveSnapshot({ accounts: [{ id: "old", label: "Old", status: "active" }], activeAccountId: "old", login: null, revision: 1, schemaVersion: 1 });
expect(screen.queryByText("Old")).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Refresh usage" }));
expect(fakeContext.rpc.invoke).toHaveBeenCalledWith("accounts.refreshUsage", null);
await runRegisteredAction("pier.codex.addAccount");
expect(fakeContext.rpc.invoke).toHaveBeenCalledWith("accounts.add", expect.objectContaining({}));
await runRegisteredAction("pier.codex.refreshUsage");
expect(fakeContext.rpc.invoke).toHaveBeenCalledWith("accounts.refreshUsage", null);
expect(fakeContext.actions.register).toHaveBeenCalledWith(expect.objectContaining({ id: "pier.codex.addAccount" }));
expect(fakeContext.actions.register).not.toHaveBeenCalledWith(expect.objectContaining({ id: "pier.codex.undeclared" }));
expect(fakeContext.configuration.get("pier.codex.confirmSwitch")).toBeDefined();
```

The fake RPC should intentionally deliver `accounts.changed` revision 2 before the delayed `accounts.snapshot` revision 1 resolves, proving the store rejects stale snapshots and keeps the newer event state.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/plugins/codex-plugin-renderer.test.tsx`

Expected: FAIL because renderer widget has not been moved.

- [ ] **Step 3: Move renderer code**

Copy `accounts-widget.tsx`, `account-actions.ts`, and `usage-meter.tsx` from `src/plugins/builtin/codex/renderer/`, replace `context.accounts.*` calls with RPC calls, replace imports from `@shared/contracts/agent-accounts` with plugin-local `../shared/accounts`, and add `accounts-store.ts` / hook that subscribes to `accounts.changed` before requesting `accounts.snapshot`. Apply only snapshots with `revision` greater than the current revision so an older initial snapshot cannot overwrite a newer event. Keep dialog usage through `context.dialogs` and keep confirm switch configuration key `pier.codex.confirmSwitch`.

- [ ] **Step 4: Register contributions**

In renderer `activate(context)`, register only commands/actions declared in `plugin.json`, dashboard widget, panel/status contributions declared in `plugin.json`, and read configuration key `pier.codex.confirmSwitch` through the plugin configuration facade. Undeclared command/action registration must be rejected by the existing declared-contribution assertion path. Codex command handlers call plugin RPC: add account -> `accounts.add`, switch account -> `accounts.select`, refresh usage -> `accounts.refreshUsage`. The widget must render a plugin-owned loading/error state when RPC fails.

- [ ] **Step 5: Run renderer plugin tests and build**

Run:

```bash
pnpm vitest run tests/unit/plugins/codex-plugin-renderer.test.tsx
pnpm plugin:codex:build
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(codex): move account widget into plugin`

---

### Task 11a: Seed Codex plugin and migrate legacy data

Split rationale: Task 11 originally did too much in one hop — bundling seed install, plugin data migration, host API deletion, and 20+ file removals into a single "typecheck green at the end" pass. Split into an **additive** 11a (seed + migration; host account API kept side-by-side) and a **subtractive** 11b (delete host account API surface with typecheck green). Between 11a and 11b the tree compiles: the Codex plugin now owns accounts, but old host APIs still exist and route to the (soon-to-be-removed) agent-accounts service.

**Files:**
- Modify: `scripts/build-dist.sh`
- Modify: `electron-builder.yml`
- Modify: `packages/plugin-codex/src/main/accounts-service.ts`
- Modify: `src/main/index.ts` (add seed install + plugin runtime activation; keep `agentAccounts` quit-flush wiring)
- Modify: `src/main/app-core/app-core.ts` (compose managed install service; keep `agentAccounts` in `PierCoreServices`)
- Create: `packages/plugin-codex/src/shared/accounts.ts` if not already created in Task 9
- Create: `src/main/services/agent-accounts/legacy-migration-adapter.ts` (private raw-fs read-only bridge exposing `{ legacyAgentAccountsStateFile, legacyAgentAccountsBaseDir, readLegacyAuthJson(accountId): Promise<string | null>, readLegacySecretsStoreEntry(key): Promise<string | null> }`; injected only when `plugin.id === "pier.codex"` by the external main runtime, per Task 5)
- Test: `tests/unit/main/codex-seed-plugin.test.ts` (seed install portion)
- Test: `tests/unit/plugins/codex-plugin-migration.test.ts` (end-to-end legacy → plugin workDir through the adapter)
- Test: `tests/unit/main/agent-accounts-legacy-migration-adapter.test.ts` (adapter reads raw legacy paths; refuses non-codex plugin ids)

**Interfaces:**
- Produces startup seed install for `pier.codex` before plugin runtime activation.
- Produces a private Codex legacy migration adapter that abstracts every legacy credential source (disk-managed `auth.json` under `userData/agent-accounts/codex/<id>/`, plus any host `SecretsStore` entries the pre-migration implementation writes) behind read-only functions.
- **Does not** remove the host `agent-accounts` service, `window.pier.accounts`, `RendererPluginContext.accounts`, `account:*` capabilities, `accounts.*` commands, or `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED`. Those are Task 11b's scope. After 11a they still exist and route to the untouched host service, side by side with the Codex plugin's newly authoritative account state.

- [ ] **Step 1: Write failing seed + migration tests**

Create `tests/unit/main/codex-seed-plugin.test.ts` asserting first startup calls `ensureBundledSeedInstalled` for `pier.codex` after userData is finalized and the resulting registry entry is external, enabled, and official. Extend `tests/unit/plugins/codex-plugin-migration.test.ts` with an end-to-end test: seed `{userData}/agent-accounts.json` + `{userData}/agent-accounts/codex/<id>/auth.json` on disk, run the Codex plugin's first-init migration, assert (a) `work/pier.codex/accounts.json` exists with migrated metadata and correct `schemaVersion`, (b) each account's credential is written to plugin-scoped `context.secrets` with `requireEncryption: true`, (c) `.pier-plugin-data-schemas.json` marker is atomically written, (d) `.migration-core-agent-accounts-complete` marker is atomically written last, (e) the legacy files under `{userData}/agent-accounts*` remain untouched (deletion is deliberately deferred so users can roll back Pier without losing accounts), (f) re-running init is idempotent (marker skip), (g) safeStorage-backed legacy credentials from `SecretsStore` are also migrated (adapter returns encrypted material) — no token content silently dropped, (h) half-migration recovery: missing `.migration-core-agent-accounts-complete` with partial `accounts.json` triggers revalidation + repair rather than skip, (i) merge rules: existing plugin accounts and secrets win, legacy fills gaps, id conflicts keep plugin record + allocate new id for legacy or skip with diagnostic, existing secrets must decrypt cleanly before being trusted, `revision` monotonically increases. Also create `tests/unit/main/agent-accounts-legacy-migration-adapter.test.ts` locking the current on-disk layout as ground truth.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/unit/main/codex-seed-plugin.test.ts tests/unit/plugins/codex-plugin-migration.test.ts tests/unit/main/agent-accounts-legacy-migration-adapter.test.ts
pnpm typecheck
```

Expected: unit tests FAIL because seed install wiring and migration adapter do not exist; `pnpm typecheck` PASS (Task 11a only adds code).

- [ ] **Step 3: Add bundled seed install and Codex resource packaging**

During app core startup after `configureAppIdentity()` has finalized userData, create managed plugin paths, initialize index store, install Codex seed from app resources if `pier.codex` is missing and no uninstall tombstone exists, then construct plugin service/runtime from the managed install service. In dev, seed can point to `packages/plugin-codex/dist-package` after `pnpm plugin:codex:build`. For production, update `scripts/build-dist.sh` to run `pnpm plugin:codex:build` before `pnpm build:electron`, and update `electron-builder.yml` `extraResources` so `packages/plugin-codex/dist-package/**` is packaged directly at app resource target `plugins/pier.codex/**` without copying generated files into tracked `resources/`. Do not put legacy account paths into the public external main plugin context. Instead, pass `legacyAgentAccountsStateFile: join(userDataDir, "agent-accounts.json")` and `legacyAgentAccountsBaseDir: join(userDataDir, "agent-accounts")` only through the internal Codex-only migration adapter when activating `pier.codex`; tests must assert another external plugin cannot observe these paths. Keep the existing `agentAccounts` service instantiation in `app-core.ts` untouched — Task 11b removes it. After 11a the Codex plugin is authoritative for account state; the host `agent-accounts` service continues to run but is fed no new user actions because the Codex plugin (loaded from the seed) now owns the UI and commands.

- [ ] **Step 4: Implement legacy migration adapter and Codex plugin migration path**

Implement `src/main/services/agent-accounts/legacy-migration-adapter.ts` as a **read-only, raw-fs** bridge:

```ts
export function createCodexLegacyMigrationAdapter(opts: { userDataDir: string; secretsStore: SecretsStore }): CodexLegacyMigrationAdapter {
  return {
    legacyAgentAccountsStateFile: join(opts.userDataDir, "agent-accounts.json"),
    legacyAgentAccountsBaseDir: join(opts.userDataDir, "agent-accounts"),
    async readLegacyAuthJson(accountId: string): Promise<string | null> { /* fs read only, no writes */ },
    async readLegacySecretsStoreEntry(key: string): Promise<string | null> { /* SecretsStore read only */ },
  };
}
```

Wire it into `external-main-runtime.ts` (Task 5) so the adapter is injected into `MainPluginContext` only when `plugin.id === "pier.codex"`. Every other plugin id gets no `codexLegacyAccounts` field, verified by a boundary test.

Then in `packages/plugin-codex/src/main/accounts-service.ts`, on first init when `accounts.json` or `.migration-core-agent-accounts-complete` is missing, read old state and credentials from the injected adapter. The adapter must expose credential sources abstractly, not only `join(legacyAgentAccountsBaseDir, "codex")`: current managed `auth.json` directories are one source, and any existing host `SecretsStore` / safeStorage-backed legacy entries must be another. Migrate through a staging directory/state: parse old state, read and validate every recoverable legacy credential source, write credentials into plugin-scoped `context.secrets` with `requireEncryption: true`, create metadata with preserved active account id and incremented `revision`, atomically write `accounts.json`, atomically write `.pier-plugin-data-schemas.json`, then write `.migration-core-agent-accounts-complete` marker last. If marker is missing on a later startup, revalidate and repair rather than skipping. Merge rules are strict: existing plugin accounts and secrets win; legacy accounts only fill missing ids; id conflicts keep the plugin record and either allocate a new id for legacy or skip with a diagnostic; existing secrets must be decryptable before being trusted; `revision` always increases from the max existing `revision`. Deletion of legacy `{userData}/agent-accounts*` files is intentionally deferred — users must be able to roll back Pier without losing accounts. Never create an active account whose credential source was referenced by old state but could not be recovered.

- [ ] **Step 5: Run seed + migration tests**

Run:

```bash
pnpm vitest run tests/unit/main/codex-seed-plugin.test.ts tests/unit/plugins/codex-plugin-migration.test.ts tests/unit/main/agent-accounts-legacy-migration-adapter.test.ts tests/unit/main/plugin-service.test.ts tests/unit/main/plugin-runtime.test.ts
pnpm typecheck
```

Expected: all PASS. `typecheck` remains green because 11a only adds code; host account API surface is untouched.

- [ ] **Step 6: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `feat(codex): seed external plugin and migrate legacy accounts`

---

### Task 11b: Remove host account API surface

Split rationale: 11b is a **subtractive** cleanup running only after 11a proves the Codex plugin is authoritative and legacy migration is complete. Its whole point is a large, focused deletion pass ending with `pnpm typecheck` green and every forbidden-import scan empty. Do not begin 11b until 11a has landed — that ensures the migration marker is written for existing installs before the host account service is deleted.

**Files:**
- Delete: `src/main/app-core/account-commands.ts`
- Delete: `src/shared/contracts/agent-accounts.ts` (only if the legacy adapter can be rewritten to parse its own private schema; otherwise defer this deletion to the adapter-sunset release and keep the file with a `@deprecated` marker)
- Delete: `src/main/services/agent-accounts/codex-provider.ts`
- Delete: `src/main/services/agent-accounts/codex-usage.ts`
- Delete: `src/main/services/agent-accounts/identity.ts`
- Delete: `src/main/services/agent-accounts/login-error.ts`
- Delete: `src/main/services/agent-accounts/service.ts`
- Delete: `src/main/services/agent-accounts/types.ts`
- Keep (temporarily): `src/main/services/agent-accounts/legacy-migration-adapter.ts` — still needed for users upgrading directly from a pre-11a build. Only delete it in a later release with a documented sunset window (out of scope here).
- Delete: `src/main/state/agent-accounts-state.ts`
- Delete: `src/renderer/stores/agent-accounts.store.ts`
- Delete: `src/renderer/lib/plugins/host-accounts-context.ts`
- Delete: `src/plugins/builtin/codex/locales/en.json`
- Delete: `src/plugins/builtin/codex/locales/index.ts`
- Delete: `src/plugins/builtin/codex/locales/zh-CN.json`
- Delete: `src/plugins/builtin/codex/main/index.ts`
- Delete: `src/plugins/builtin/codex/manifest.ts`
- Delete: `src/plugins/builtin/codex/renderer/account-actions.ts`
- Delete: `src/plugins/builtin/codex/renderer/accounts-widget.tsx`
- Delete: `src/plugins/builtin/codex/renderer/index.tsx`
- Delete: `src/plugins/builtin/codex/renderer/usage-meter.tsx`
- Modify: `src/main/index.ts` (remove `appCore.services.agentAccounts.flush()` from quit path; now covered by `pluginRuntime.flushAllBeforeQuit()` added in Task 5)
- Modify: `src/main/app-core/app-core.ts` (remove `agentAccounts` from `PierCoreServices` and all wiring)
- Modify: `src/main/app-core/command-router.ts` (remove `accounts.*` cases)
- Modify: `src/main/app-core/command-router-services.ts` (remove `agentAccounts` field)
- Modify: `src/shared/contracts/commands.ts` (drop `accounts.*` variants from `PierCommand`)
- Modify: `src/shared/contracts/permissions.ts` (drop `account:read` / `account:write`)
- Modify: `src/main/app-core/permissions.ts` (drop `accounts.*` command metadata; drop `account:*` from default capability grants)
- Modify: `src/shared/ipc-channels.ts` (drop `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED`; the literal `pier://agent-accounts:changed` is removed with it)
- Modify: `src/preload/index.ts` (drop `window.pier.accounts` facade entirely)
- Modify: `src/renderer/lib/plugins/host-context.ts` (drop `accounts` field on renderer plugin context)
- Modify: `src/renderer/main.tsx` (drop account-store initialization/imports)
- Modify: `src/plugins/api/renderer.ts` (drop `accounts` member from `RendererPluginContext`)
- Modify: `packages/plugin-api/src/renderer.ts` (already free of `accounts` per Task 6; re-verify with test)
- Modify: `src/main/plugins/builtin-catalog.ts` (drop Codex entry — plugin is now external)
- Modify: `src/renderer/lib/plugins/builtin-catalog.ts` (drop Codex entry)
- Test: `tests/unit/main/plugin-runtime.test.ts`
- Test: `tests/unit/main/plugin-service.test.ts`
- Test: `tests/unit/renderer/plugin-bootstrap.test.ts`
- Test: `tests/unit/renderer/plugin-rpc-context.test.ts`
- Test: `tests/unit/plugins/codex-plugin-renderer.test.tsx`
- Delete: `tests/unit/main/agent-accounts-codex-provider.test.ts`
- Delete: `tests/unit/main/agent-accounts-codex-usage.test.ts`
- Delete: `tests/unit/main/agent-accounts-identity.test.ts`
- Delete: `tests/unit/main/agent-accounts-service.test.ts`
- Delete: `tests/unit/main/agent-accounts-state.test.ts`
- Delete: `tests/unit/renderer/agent-accounts-store.test.ts`
- Delete: `tests/unit/renderer/host-accounts-context.test.ts`
- Delete: `tests/unit/renderer/codex-account-actions.test.ts`
- Delete: `tests/component/codex-accounts-widget.test.tsx`
- Delete: `tests/unit/shared/agent-accounts-schema.test.ts`

**Interfaces:**
- Removes the host account API surface entirely: types, contracts, capabilities, services, stores, preload, renderer facade, broadcasts, builtin registration.
- Leaves the private legacy-migration adapter in place (see Files) as the only remaining survivor of the account domain in `src/main/`, exclusively serving the Codex plugin's first-init migration for users upgrading from pre-11a builds.

- [ ] **Step 1: Write failing removal contract test**

Extend `tests/unit/main/codex-seed-plugin.test.ts` (or add `tests/unit/shared/host-account-api-removal.test.ts`) with contract assertions that `window.pier.accounts` is absent from preload test mocks, `account:read` / `account:write` are absent from capability schema, `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED` and literal `pier://agent-accounts:changed` are absent from `src/shared/ipc-channels.ts`, `RendererPluginContext` has no `accounts` member, `accounts.*` command variants are absent from `PierCommand`, and no source file imports `@shared/contracts/agent-accounts` outside `src/main/services/agent-accounts/legacy-migration-adapter.ts` and its test (until the adapter is sunset).

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run tests/unit/main/codex-seed-plugin.test.ts
pnpm typecheck
```

Expected: FAIL because old builtin Codex and account APIs still exist.

- [ ] **Step 3: Remove builtin Codex registration**

Remove Codex from main and renderer builtin catalogs. Delete `src/plugins/builtin/codex/**` after 11a's package plugin tests still pass. Dashboard layout residual cards should use existing missing-widget fallback, with copy updated to `Plugin not installed or disabled`.

- [ ] **Step 4: Remove core account APIs**

Delete account service/state/store files per Files list. Remove account command router cases and the `executeAccountCommand` path, remove `agentAccounts` from `PierCoreServices`, remove quit flush/final cleanup calls to `appCore.services.agentAccounts` in `src/main/index.ts` (now covered by `pluginRuntime.flushAllBeforeQuit()`), remove preload `window.pier.accounts`, remove `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED` from `src/shared/ipc-channels.ts`, renderer `context.accounts`, account-store initialization/imports from `src/renderer/main.tsx`, public `RendererPluginContext.accounts` from `src/plugins/api/renderer.ts`, and all account capability grants. Confirm `packages/plugin-api/src/renderer.ts` still has no `accounts` export.

Run repo-wide cleanup scans and fix every compile reference. Split the scan into forbidden host account API references and allowed `pier.codex` private RPC method names so the new plugin RPC contract is not treated as a leftover host API.

Forbidden host API scan:

```bash
rg "window\\.pier\\.accounts|context\\.accounts|RendererPluginContext\\.accounts|@shared/contracts/agent-accounts|PIER_BROADCAST\\.AGENT_ACCOUNTS_CHANGED|pier://agent-accounts:changed|account:(read|write)" src tests packages
```

Expected result: only matches inside `src/main/services/agent-accounts/legacy-migration-adapter.ts` and its test (the adapter reads legacy schema types until it is sunset in a later release). `accounts.snapshot`, `accounts.add`, `accounts.cancelLogin`, `accounts.select`, `accounts.remove`, `accounts.refreshUsage`, `accounts.adoptCurrent`, and `accounts.changed` are allowed only as `pier.codex` plugin-local RPC method/event names under `packages/plugin-codex/src/**`, plugin RPC tests, and the design/plan docs. Add a positive allowlist assertion for those locations instead of banning the method strings globally.

If the legacy adapter can be rewritten to parse the legacy JSON with a small private schema of its own, delete `@shared/contracts/agent-accounts` outright in this task — the smaller the surface remaining, the easier the eventual adapter sunset. Otherwise mark it `@deprecated` and note the sunset target release.

- [ ] **Step 5: Run removal tests**

Run:

```bash
pnpm vitest run tests/unit/main/codex-seed-plugin.test.ts tests/unit/main/plugin-runtime.test.ts tests/unit/main/plugin-service.test.ts tests/unit/renderer/plugin-bootstrap.test.ts tests/unit/renderer/plugin-rpc-context.test.ts tests/unit/plugins/codex-plugin-migration.test.ts tests/unit/plugins/codex-plugin-renderer.test.tsx
pnpm typecheck
```

Expected: PASS. Every deleted test file no longer exists; every remaining test still passes; forbidden host account API reference scan finds only the whitelisted legacy-migration adapter locations.

- [ ] **Step 6: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `refactor(codex): remove host account API surface`

---

### Task 12: Boundary tests, docs, and full verification

**Files:**
- Modify: `dependency-cruiser.config.cjs`
- Modify: `scripts/check-file-size.sh`
- Modify: `AGENTS.md`
- Modify: `package.json`
- Create: `tests/unit/plugins/external-plugin-boundary.test.ts`
- Create: `tests/unit/plugins/plugin-api-boundary.test.ts`
- Create: `tests/e2e/managed-plugin-update-flow.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-07-managed-external-plugins-and-codex-migration-design.md`

**Interfaces:**
- Produces guardrails that external plugins import only `@pier/plugin-api`, `@pier/ui`, `lucide-react`, React imports handled by the build preset, approved shared contracts, and plugin-local files, and that `packages/plugin-api` itself does not import app internals such as `src/main`, `src/renderer`, or builtin plugin implementations.
- Produces docs that state trusted-plugin boundary clearly.
- Produces an Electron/Playwright managed-plugin flow with a mocked signed official index: open plugin settings, check updates, install/update, show restart-required, restart, verify effective version, simulate a bad main/renderer package activation failure, show diagnostics, roll back to last-known-good, uninstall, restart, and verify bundled seed does not resurrect an uninstall tombstone.

- [ ] **Step 1: Write boundary tests**

Add tests asserting:

```ts
expect(scanImports("packages/plugin-codex/src")).not.toContainImportMatching(/^src\//);
expect(scanImports("packages/plugin-codex/src")).not.toContainImportMatching(/src\/renderer|src\/main/);
expect(scanImports("packages/plugin-api/src")).not.toContainImportMatching(/src\/main|src\/renderer|@plugins\/builtin|plugins\/builtin/);
expect(scanImports("src")).not.toContainImportMatching(/src\/plugins\/builtin\/codex/);
expect(scanImports("src")).not.toContainImportMatching(/@plugins\/builtin\/codex/);
expect(scanImports("src")).not.toContainImportMatching(/plugins\/builtin\/codex/);
expect(scanImports("src")).not.toContainImportMatching(/packages\/plugin-codex\/src|@pier\/plugin-codex\/src/);
expect(scanFileText("src/main/plugins/builtin-catalog.ts")).not.toContain("plugins/builtin/codex");
expect(scanFileText("src/renderer/lib/plugins/builtin-catalog.ts")).not.toContain("plugins/builtin/codex");
```

- [ ] **Step 2: Run boundary tests to verify they fail on any remaining forbidden imports**

Run: `pnpm vitest run tests/unit/plugins/external-plugin-boundary.test.ts tests/unit/plugins/plugin-api-boundary.test.ts`

Expected: PASS if Task 11 removed old imports; FAIL output lists exact remaining import to delete.

- [ ] **Step 3: Update dependency-cruiser and AGENTS**

Review and tighten package boundary rules for both `packages/plugin-codex` and `packages/plugin-api` that were introduced in Task 0 / Task 6 / Task 8. `packages/plugin-api` may expose types and shims but must not import `src/main`, `src/renderer`, or builtin plugin implementations; `packages/plugin-codex` may import `@pier/plugin-api`, `@pier/ui`, `lucide-react`, React imports that are rewritten by the build preset, approved shared contracts, and plugin-local files only. `src/**` must not statically import `packages/plugin-codex/src/**`; the app consumes the built seed package through managed install/runtime paths. Confirm `scripts/check-file-size.sh` scans `packages/*/src` in addition to `src`, excluding generated `dist`, `dist-package`, and build output. Confirm AGENTS.md plugin boundary section states v1 external plugins are trusted Node/React code, not a sandbox, and official plugins use managed install/index/update state.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:packages
pnpm plugin:codex:build
pnpm test:unit
pnpm test:component
pnpm test:e2e -- tests/e2e/managed-plugin-update-flow.spec.ts tests/e2e/plugin-asset-protocol.spec.ts
pnpm check
```

Expected: all commands PASS.

- [ ] **Step 5: Review checkpoint and optional commit approval gate**

Do not commit by default. If the user explicitly requests a commit for this task, stage only the exact task paths, show `git diff --staged` plus the proposed Conventional Commit message below, then wait for explicit approval before running `git commit`.

No staging command is preapproved. If a commit is explicitly requested, run `git status --short`, stage only exact changed file paths from this task's **Files** list, show `git diff --staged`, propose the message below, and wait for confirmation. Never use `git add .` or broad directory staging.

Proposed commit message: `test(plugins): enforce external plugin boundaries`

---

## Self-Review

### Spec coverage

- Managed install state, staging, immutable versions: Tasks 2 and 3.
- Official index and GitHub Release asset update flow: Tasks 2 and 3.
- Manual update and restart-required behavior: Tasks 3 and 7.
- `pier-plugin://` protocol, CSP, and startup ordering: Task 4.
- Main and renderer dynamic runtime: Tasks 5 and 6.
- Plugin RPC/Event Bus: Tasks 5 and 6.
- React singleton/shared renderer bridge: Task 6.
- Dev plugin override: Tasks 3 and 7.
- Codex default bundled seed: Task 11a.
- Codex account domain migration: Tasks 9, 10, and 11a.
- Host account API removal: Tasks 1 (deferred metadata cleanup entry), 6 (external renderer context defined without `accounts`), and 11b (actual deletion).
- Plugin management UI: Task 7.
- Boundary and regression checks: Task 12.

### Placeholder scan

The scan found no unfinished-marker text in task instructions. The plan defers no named requirement and gives exact file paths, commands, and expected outcomes for every task.

### Type consistency

- `pluginId`, `method`, `payload`, and `event` names match across `plugin-rpc.ts`, main bus, preload bridge, renderer context, and Codex plugin RPC calls.
- Runtime kind `external` and `rendererEntryUrl` names match shared contract, plugin service, renderer loader, and tests.
- Codex RPC method names match spec: `accounts.snapshot`, `accounts.add`, `accounts.cancelLogin`, `accounts.select`, `accounts.remove`, `accounts.refreshUsage`, `accounts.adoptCurrent`.
