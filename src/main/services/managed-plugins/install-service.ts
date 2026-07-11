import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagedPluginCatalogSnapshot,
  ManagedPluginInstallIndex,
  ManagedPluginInstallIndexEntry,
  ManagedPluginOperationResult,
  OfficialPluginIndex,
} from "@shared/contracts/managed-plugin.ts";
import {
  computeSimulateRestartMutation,
  performListCatalogSnapshot,
} from "./catalog-operations.ts";
import { assertPluginDataSchemaCompatibility } from "./data-schema-compatibility.ts";
import {
  performClearDevOverride,
  performSetDevOverride,
} from "./dev-override-operations.ts";
import type { ManagedPluginIndexStore } from "./index-state.ts";
import {
  type AssetFetcher,
  type BundledPluginRegistration,
  type OperationsContext,
  performInstall,
  performRollback,
  performUninstall,
  setEnabledFlag,
} from "./install-operations.ts";
import {
  cleanupStalePromotionTemps,
  defaultCopyDirectory,
  type ManagedPluginRuntimeSource,
  materializeRuntimeSource,
  promoteArchiveToInstalled,
} from "./install-runtime.ts";
import type { ManagedPluginOperationLogRecord } from "./operation-log.ts";
import { computePackageContentHash } from "./package-content-hash.ts";
import { validateManagedPluginPackage } from "./package-validation.ts";
import type { ManagedPluginPaths } from "./paths.ts";
import { performUpdate } from "./update-operations.ts";

/**
 * Managed plugin install service (design §6, plan Task 3).
 *
 * Coordinates a single mutation queue across install index writes, operation
 * log appends, and staging/installed cleanup. Delegates the individual
 * operations to `./install-operations.ts` and runtime-source materialization
 * to `./install-runtime.ts` so this file stays under the file-size hard cap.
 */

export type RuntimeMode = "development" | "production" | "test";

export type { BundledPluginRegistration } from "./install-operations.ts";
export type { ManagedPluginRuntimeSource } from "./install-runtime.ts";

export interface RecordActivationResultInput {
  readonly diagnosticId?: string;
  readonly error?: string;
  readonly ok: boolean;
  readonly phase: "main" | "renderer";
  readonly pluginId: string;
  readonly version: string;
  readonly windowId?: string;
}

export interface CreateManagedPluginInstallServiceOptions {
  readonly appendOperationLog: (
    record: ManagedPluginOperationLogRecord
  ) => Promise<void>;
  readonly assetFetcher?: AssetFetcher;
  readonly bundledPlugins?: readonly BundledPluginRegistration[];
  readonly copyDirectory?: (src: string, dest: string) => Promise<void>;
  readonly expectedRendererWindowIds?: () => readonly string[];
  readonly now?: () => number;
  readonly officialIndexProvider?: () => OfficialPluginIndex | null;
  readonly officialIndexRefresh?: (options?: {
    force?: boolean;
  }) => Promise<void>;
  readonly onRuntimeSourcesChanged?: (
    sources: readonly ManagedPluginRuntimeSource[]
  ) => Promise<void>;
  readonly paths: ManagedPluginPaths;
  readonly pierVersion: string;
  readonly runtimeMode: RuntimeMode;
  readonly store: ManagedPluginIndexStore;
}

interface ActivationTracker {
  mainOk?: boolean;
  rendererWindowOks: Record<string, boolean>;
}

export interface ManagedPluginInstallService {
  readonly checkUpdates: () => Promise<ManagedPluginCatalogSnapshot>;
  readonly clearDevOverride: (
    id: string
  ) => Promise<ManagedPluginOperationResult>;
  readonly disable: (id: string) => Promise<ManagedPluginOperationResult>;
  readonly enable: (id: string) => Promise<ManagedPluginOperationResult>;
  readonly getIndex: () => ManagedPluginInstallIndex;
  readonly getRuntimeSources: () => readonly ManagedPluginRuntimeSource[];
  readonly init: () => Promise<void>;
  readonly install: (id: string) => Promise<ManagedPluginOperationResult>;
  readonly listCatalogSnapshot: () => Promise<ManagedPluginCatalogSnapshot>;
  readonly listRuntimeSources: () => Promise<
    readonly ManagedPluginRuntimeSource[]
  >;
  readonly recordActivationResult: (
    input: RecordActivationResultInput
  ) => Promise<void>;
  readonly refreshRuntimeSources: () => Promise<void>;
  readonly rollback: (
    id: string,
    version: string
  ) => Promise<ManagedPluginOperationResult>;
  readonly setDevOverride: (
    id: string,
    path: string
  ) => Promise<ManagedPluginOperationResult>;
  /**
   * Applies `computeSimulateRestartMutation` to clear pendingRestart,
   * disposes/creates `effectiveAtStartup` from installed state, and refreshes
   * the runtime snapshot. Used by tests to advance restart-gated state; used
   * by the dev `app.relaunch` path (which reloads the renderer without
   * quitting the main process) to make plugin uninstall visible without
   * killing electron-vite.
   */
  readonly simulateRestartForTests: () => Promise<void>;
  readonly uninstall: (id: string) => Promise<ManagedPluginOperationResult>;
  readonly update: (id: string) => Promise<ManagedPluginOperationResult>;
}

export function createManagedPluginInstallService(
  options: CreateManagedPluginInstallServiceOptions
): ManagedPluginInstallService {
  const { appendOperationLog, paths, pierVersion, runtimeMode, store } =
    options;
  const now = options.now ?? Date.now;
  const copyDirectory = options.copyDirectory ?? defaultCopyDirectory;
  const isDevRuntime = runtimeMode === "development" || runtimeMode === "test";
  const officialIndexProvider = options.officialIndexProvider ?? (() => null);

  let mutationQueue: Promise<unknown> = Promise.resolve();
  const activationTrackers: Record<string, ActivationTracker> = {};
  let runtimeSourcesSnapshot: readonly ManagedPluginRuntimeSource[] = [];

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = mutationQueue.then(task, task);
    mutationQueue = next.catch(() => {
      /* keep chain alive */
    });
    return next as Promise<T>;
  }

  async function refreshRuntimeSnapshot(): Promise<void> {
    const state = store.get();
    const sources: ManagedPluginRuntimeSource[] = [];
    const runtimeCtx = { isDevRuntime, paths, pierVersion };
    for (const [pluginId, entry] of Object.entries(state.plugins)) {
      if (!entry.effectiveAtStartup) {
        continue;
      }
      const source = await materializeRuntimeSource(
        runtimeCtx,
        pluginId,
        entry
      );
      if (source) {
        sources.push(source);
      }
    }
    runtimeSourcesSnapshot = sources;
    if (options.onRuntimeSourcesChanged) {
      await options.onRuntimeSourcesChanged(sources);
    }
  }

  const bundledPlugins = options.bundledPlugins ?? [];
  const ctx: OperationsContext = {
    appendOperationLog,
    bundledPlugins,
    copyDirectory,
    isDevRuntime,
    now,
    officialIndexProvider,
    paths,
    pierVersion,
    refreshRuntimeSnapshot,
    store,
    ...(options.assetFetcher ? { assetFetcher: options.assetFetcher } : {}),
    ...(options.officialIndexRefresh
      ? { officialIndexRefresh: options.officialIndexRefresh }
      : {}),
  };

  async function repairMissingContentHashes(): Promise<void> {
    const state = store.get();
    const repairedPlugins = { ...state.plugins };
    let changed = false;
    for (const [pluginId, entry] of Object.entries(state.plugins)) {
      const installedVersions = { ...entry.installedVersions };
      const quarantinedVersions = new Set<string>();
      for (const [version, record] of Object.entries(installedVersions)) {
        if (record.contentHash) continue;
        const installedPackageDir = join(paths.installedDir, pluginId, version);
        try {
          await access(installedPackageDir);
        } catch {
          // Missing packages are handled by runtime-source resolution. There is
          // nothing to migrate (or trust) until a verified install recreates it.
          continue;
        }
        const bundled = bundledPlugins.find(
          (candidate) =>
            candidate.id === pluginId &&
            candidate.version === version &&
            candidate.sha256 === record.sha256
        );
        if (!bundled) {
          // Pre-contentHash official downloads cannot be trusted retroactively:
          // hashing the existing directory would bless potentially modified
          // code. Isolate only that version and leave the catalog available so
          // an explicit install/update can fetch a signed archive again.
          await rm(installedPackageDir, { force: true, recursive: true });
          delete installedVersions[version];
          quarantinedVersions.add(version);
          changed = true;
          continue;
        }
        await promoteArchiveToInstalled(
          { now, paths, pierVersion },
          {
            archivePath: bundled.archivePath,
            id: pluginId,
            overwrite: true,
            sha256: bundled.sha256,
            ...(bundled.size ? { size: bundled.size } : {}),
            version,
          }
        );
        installedVersions[version] = {
          ...record,
          contentHash: await computePackageContentHash(installedPackageDir),
          verifiedHash: bundled.sha256,
        };
        changed = true;
      }
      const activeWasQuarantined = Boolean(
        entry.activeVersion && quarantinedVersions.has(entry.activeVersion)
      );
      const effectiveWasQuarantined = Boolean(
        entry.effectiveAtStartup &&
          quarantinedVersions.has(entry.effectiveAtStartup.version)
      );
      repairedPlugins[pluginId] = {
        ...entry,
        activeVersion: activeWasQuarantined ? null : entry.activeVersion,
        effectiveAtStartup: effectiveWasQuarantined
          ? null
          : entry.effectiveAtStartup,
        enabled:
          activeWasQuarantined || effectiveWasQuarantined
            ? false
            : entry.enabled,
        installedVersions,
        lastKnownGoodVersion:
          entry.lastKnownGoodVersion &&
          quarantinedVersions.has(entry.lastKnownGoodVersion)
            ? null
            : entry.lastKnownGoodVersion,
        pendingRestart:
          entry.pendingRestart?.version &&
          quarantinedVersions.has(entry.pendingRestart.version)
            ? null
            : entry.pendingRestart,
        pendingUpdate:
          entry.pendingUpdate &&
          quarantinedVersions.has(entry.pendingUpdate.version)
            ? null
            : entry.pendingUpdate,
      };
    }
    if (changed) {
      store.mutate((current) => ({
        ...current,
        plugins: repairedPlugins,
      }));
      await store.flush();
    }
  }

  async function performSimulateRestartForTests(): Promise<void> {
    await enqueue(async () => {
      const state = store.get();
      const next = computeSimulateRestartMutation(state, isDevRuntime);
      store.mutate(() => next);
      await store.flush();
    });
    await refreshRuntimeSnapshot();
  }

  async function performRecordActivationResult(
    input: RecordActivationResultInput
  ): Promise<void> {
    await enqueue(async () => {
      const key = `${input.pluginId}@${input.version}`;
      const tracker = activationTrackers[key] ?? { rendererWindowOks: {} };
      if (input.phase === "main") {
        tracker.mainOk = input.ok;
      } else if (input.windowId) {
        tracker.rendererWindowOks[input.windowId] = input.ok;
      }
      activationTrackers[key] = tracker;
      const rendererResults = Object.values(tracker.rendererWindowOks);
      const anyRendererOk = rendererResults.some((value) => value === true);
      const anyFailed =
        tracker.mainOk === false || rendererResults.includes(false);
      if (anyFailed) {
        store.mutate((state) => {
          const entry = state.plugins[input.pluginId];
          if (entry?.lastKnownGoodVersion !== input.version) return state;
          return {
            ...state,
            plugins: {
              ...state.plugins,
              [input.pluginId]: { ...entry, lastKnownGoodVersion: null },
            },
          };
        });
        await store.flush();
        return;
      }
      const expectedWindowIds = options.expectedRendererWindowIds?.() ?? [];
      const allExpectedRenderersOk =
        expectedWindowIds.length === 0
          ? anyRendererOk
          : expectedWindowIds.every(
              (windowId) => tracker.rendererWindowOks[windowId] === true
            );
      if (!(tracker.mainOk === true && allExpectedRenderersOk)) return;
      const entry = store.get().plugins[input.pluginId];
      const installed = entry?.installedVersions[input.version];
      if (
        !(
          entry?.effectiveAtStartup?.enabled === true &&
          entry.effectiveAtStartup.version === input.version &&
          installed &&
          installed.verifiedHash === installed.sha256 &&
          typeof installed.contentHash === "string"
        )
      ) {
        return;
      }
      try {
        const packageDir = join(
          paths.installedDir,
          input.pluginId,
          input.version
        );
        const { manifest } = await validateManagedPluginPackage({
          archivePath: null,
          expectedId: input.pluginId,
          expectedSha256: null,
          expectedSize: null,
          expectedVersion: input.version,
          packageDir,
          pierVersion,
        });
        await assertPluginDataSchemaCompatibility({
          manifest,
          pluginId: input.pluginId,
          workDir: paths.workDir,
        });
        if (
          (await computePackageContentHash(packageDir)) !==
          installed.contentHash
        ) {
          return;
        }
      } catch {
        return;
      }
      store.mutate((state) => {
        const current = state.plugins[input.pluginId];
        if (
          current?.effectiveAtStartup?.enabled !== true ||
          current.effectiveAtStartup.version !== input.version
        ) {
          return state;
        }
        return {
          ...state,
          plugins: {
            ...state.plugins,
            [input.pluginId]: {
              ...current,
              lastKnownGoodVersion: input.version,
            },
          },
        };
      });
      await store.flush();
    });
  }

  return {
    async checkUpdates(): Promise<ManagedPluginCatalogSnapshot> {
      if (ctx.officialIndexRefresh) {
        await ctx.officialIndexRefresh({ force: true });
      }
      return await performListCatalogSnapshot(ctx);
    },
    clearDevOverride: (id) => enqueue(() => performClearDevOverride(ctx, id)),
    disable: (id) => enqueue(() => setEnabledFlag(ctx, id, false)),
    enable: (id) => enqueue(() => setEnabledFlag(ctx, id, true)),
    install: (id) => enqueue(() => performInstall(ctx, id)),
    getIndex: () => store.get(),
    async init(): Promise<void> {
      await mkdir(paths.pluginsDir, { recursive: true });
      await mkdir(paths.installedDir, { recursive: true });
      await mkdir(paths.stagingDir, { recursive: true });
      await mkdir(paths.workDir, { recursive: true });
      await store.init();
      await cleanupStalePromotionTemps(paths.installedDir);
      await repairMissingContentHashes();
      if (!isDevRuntime) {
        const state = store.get();
        let mutated = false;
        const filteredPlugins: Record<string, ManagedPluginInstallIndexEntry> =
          {};
        for (const [id, entry] of Object.entries(state.plugins)) {
          if (entry.devOverride) {
            filteredPlugins[id] = { ...entry, devOverride: null };
            mutated = true;
          } else {
            filteredPlugins[id] = entry;
          }
        }
        if (mutated) {
          store.mutate((s) => ({ ...s, plugins: filteredPlugins }));
          await store.flush();
        }
      }
      await performSimulateRestartForTests();
    },
    listCatalogSnapshot: () => performListCatalogSnapshot(ctx),
    getRuntimeSources: () => runtimeSourcesSnapshot,
    listRuntimeSources: async () => runtimeSourcesSnapshot,
    recordActivationResult: (input) => performRecordActivationResult(input),
    refreshRuntimeSources: () => enqueue(() => refreshRuntimeSnapshot()),
    rollback: (id, version) => enqueue(() => performRollback(ctx, id, version)),
    setDevOverride: (id, path) =>
      enqueue(() => performSetDevOverride(ctx, id, path)),
    simulateRestartForTests: () => performSimulateRestartForTests(),
    uninstall: (id) => enqueue(() => performUninstall(ctx, id)),
    update: (id) => enqueue(() => performUpdate(ctx, id)),
  };
}
