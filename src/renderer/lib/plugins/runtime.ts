import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { closeOverlaysForPlugin } from "../../stores/plugin-overlay.store.ts";
import { BUILTIN_RENDERER_PLUGIN_MODULES } from "./builtin-catalog.ts";
import { createExternalRendererActivationScope } from "./external-activation-scope.ts";
import { loadExternalModuleWithTimeout } from "./external-module-load.ts";
import { ExternalPanelPlaceholderRegistry } from "./external-panel-placeholders.tsx";
import {
  createExternalRendererPluginContext,
  type RendererPluginRpcBridge,
} from "./external-plugin-context.ts";
import { loadExternalRendererModule } from "./external-renderer-loader.ts";
import { ExternalTransitionGate } from "./external-transition-gate.ts";
import { createRendererPluginContext } from "./host-context.ts";
import { clearHostGroupContentForPlugin } from "./host-group-content-context.tsx";
import { pluginLifecycleBarriers } from "./plugin-lifecycle-barriers.ts";
import type { RendererPluginSuspendReason } from "./plugin-lifecycle-types.ts";
import {
  clearRendererPluginRuntimeDiagnostic,
  reportRendererPluginRuntimeDiagnostic,
} from "./plugin-runtime-diagnostics.ts";
import { installPluginSharedRuntime } from "./plugin-shared-runtime.ts";
import { createRendererPluginRpcBridge } from "./renderer-plugin-rpc-bridge.ts";
import { disposeRendererPluginsAfterDrain } from "./runtime-dispose-all.ts";
import { PluginRuntimeDrainRetryCoordinator } from "./runtime-drain-retry.ts";
import {
  desiredExternalSignature,
  desiredRendererEntries,
  indexRendererPluginModules,
  runtimeEntrySignature,
} from "./runtime-entry-signature.ts";
import {
  invalidateSupersededExternalAttempts,
  type PendingExternalAttempt,
} from "./runtime-external-invalidation.ts";
import { MainDisposalAuthorizationStore } from "./runtime-main-disposal-authorizations.ts";
import {
  type ActiveRendererPlugin,
  suspendAndDisposeOwnedRendererPlugin,
} from "./runtime-plugin-disposal.ts";

export class RendererPluginRuntime {
  private readonly active = new Map<string, ActiveRendererPlugin>();
  private readonly modules: ReadonlyMap<string, RendererPluginModule>;
  private readonly rpcBridge: RendererPluginRpcBridge;
  private readonly externalLoader: typeof loadExternalRendererModule;
  private readonly externalLoadTimeoutMs: number;
  private readonly externalPanelPlaceholders =
    new ExternalPanelPlaceholderRegistry();
  private readonly externalDiagnosticPluginIds = new Set<string>();
  private readonly pendingExternal = new Map<string, PendingExternalAttempt>();
  private readonly externalTransitionGate = new ExternalTransitionGate();
  private readonly mainDisposalAuthorizations =
    new MainDisposalAuthorizationStore();
  private readonly drainRetries = new PluginRuntimeDrainRetryCoordinator();
  private desired = new Map<string, PluginRegistryEntry>();
  private disposed = false;
  private externalStarted = false;
  private refreshGeneration = 0;
  private lastTransitionError: Error | null = null;
  private sharedRuntimeInstalled = false;
  private latestEntries: readonly PluginRegistryEntry[] = [];
  private transitionTail: Promise<void> = Promise.resolve();

  constructor(
    modules: readonly RendererPluginModule[] = BUILTIN_RENDERER_PLUGIN_MODULES,
    options: {
      externalLoadTimeoutMs?: number;
      loadExternalModule?: typeof loadExternalRendererModule;
    } = {}
  ) {
    this.modules = indexRendererPluginModules(modules);
    this.rpcBridge = createRendererPluginRpcBridge();
    this.externalLoader =
      options.loadExternalModule ?? loadExternalRendererModule;
    this.externalLoadTimeoutMs = options.externalLoadTimeoutMs ?? 10_000;
  }
  diagnostics(): {
    lastTransitionError: Error | null;
    pendingExternalPluginIds: readonly string[];
  } {
    return {
      lastTransitionError: this.lastTransitionError,
      pendingExternalPluginIds: [...this.pendingExternal.keys()],
    };
  }
  dispose(): Promise<void> {
    this.disposed = true;
    this.refreshGeneration += 1;
    pluginLifecycleBarriers.cancelRuntimePreparations();
    this.desired.clear();
    this.latestEntries = [];
    for (const pending of this.pendingExternal.values()) {
      pending.abortController.abort();
    }
    this.pendingExternal.clear();
    this.drainRetries.clear();
    this.externalTransitionGate.clear();
    this.mainDisposalAuthorizations.clear();
    this.externalPanelPlaceholders.dispose();
    for (const pluginId of this.externalDiagnosticPluginIds) {
      clearRendererPluginRuntimeDiagnostic(pluginId);
    }
    this.externalDiagnosticPluginIds.clear();
    return this.enqueue(async () => {
      const pluginIds = [...this.active.keys()];
      await disposeRendererPluginsAfterDrain(
        pluginIds,
        "runtime-dispose",
        (pluginId) => pluginLifecycleBarriers.waitForPluginDrain(pluginId),
        (pluginId, reason) => this.suspendAndDispose(pluginId, reason)
      );
    });
  }
  refresh(
    entries: readonly PluginRegistryEntry[],
    options: { startExternal?: boolean } = {}
  ): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("renderer plugin runtime is disposed"));
    }
    const snapshot = [...entries];
    const generation = ++this.refreshGeneration;
    pluginLifecycleBarriers.cancelRuntimePreparations();
    this.latestEntries = snapshot;
    this.desired = desiredRendererEntries(snapshot);
    invalidateSupersededExternalAttempts({
      desired: this.desired,
      diagnosticPluginIds: this.externalDiagnosticPluginIds,
      hasTransitionGate: (pluginId) =>
        this.externalTransitionGate.has(pluginId),
      pending: this.pendingExternal,
    });
    this.externalTransitionGate.releaseConfirmed((pluginId) =>
      desiredExternalSignature(this.desired, pluginId)
    );
    const coreReady = this.enqueue(() =>
      this.reconcileCore(new Map(this.desired), generation)
    );
    if (options.startExternal ?? this.externalStarted) {
      coreReady.then(
        () => this.startExternalActivations(),
        () => this.startExternalActivations()
      );
    }
    return coreReady;
  }
  private activateBuiltin(entry: PluginRegistryEntry): (() => void) | null {
    const module = this.modules.get(entry.manifest.id);
    if (!module) return null;
    const context = createRendererPluginContext(entry);
    const dispose = module.activate(context);
    return () => {
      try {
        dispose();
      } finally {
        clearHostGroupContentForPlugin(entry.manifest.id);
        closeOverlaysForPlugin(entry.manifest.id);
      }
    };
  }
  startExternalActivations(): void {
    if (this.disposed) {
      return;
    }
    this.externalStarted = true;
    for (const entry of this.desired.values()) {
      if (
        entry.runtime.kind !== "external" ||
        !entry.runtime.rendererEntryUrl ||
        this.active.has(entry.manifest.id) ||
        this.pendingExternal.has(entry.manifest.id) ||
        this.externalTransitionGate.has(entry.manifest.id)
      ) {
        continue;
      }
      this.startExternalActivation(entry);
    }
  }
  prepareExternalTransition(
    pluginId: string,
    reason: "plugin-disable" | "plugin-reload",
    transitionId: string,
    generation: number
  ): boolean {
    const accepted = this.externalTransitionGate.prepare({
      generation,
      pluginId,
      reason,
      signature: desiredExternalSignature(this.desired, pluginId),
      transitionId,
    });
    if (!accepted) {
      return false;
    }
    const pending = this.pendingExternal.get(pluginId);
    pending?.abortController.abort();
    this.pendingExternal.delete(pluginId);
    return true;
  }
  async finalizeExternalTransition(
    pluginId: string,
    transitionId: string,
    generation: number,
    outcome: "abort" | "commit"
  ): Promise<void> {
    this.mainDisposalAuthorizations.finalize(this.externalTransitionGate, {
      desiredSignature: desiredExternalSignature(this.desired, pluginId),
      generation,
      outcome,
      pluginId,
      transitionId,
    });
    await this.reconcileLatestDesired();
  }
  private async activateExternalAttempt(
    entry: PluginRegistryEntry,
    signature: string,
    token: symbol
  ): Promise<void> {
    const pluginId = entry.manifest.id;
    let activationScope: ReturnType<
      typeof createExternalRendererActivationScope
    > | null = null;
    if (!entry.runtime.rendererEntryUrl) {
      return;
    }
    if (!this.sharedRuntimeInstalled) {
      installPluginSharedRuntime();
      this.sharedRuntimeInstalled = true;
    }
    try {
      const pending = this.pendingExternal.get(pluginId);
      if (!pending || pending.token !== token) {
        return;
      }
      const module = await loadExternalModuleWithTimeout({
        entry,
        loader: this.externalLoader,
        signal: pending.abortController.signal,
        timeoutMs: this.externalLoadTimeoutMs,
      });
      if (!this.isCurrentExternalAttempt(pluginId, signature, token)) {
        return;
      }
      const scope = createExternalRendererActivationScope();
      activationScope = scope;
      const context = createExternalRendererPluginContext(
        entry,
        this.rpcBridge,
        () => this.latestEntries,
        scope,
        (registration) =>
          this.externalPanelPlaceholders.registerImplementation(
            entry,
            registration
          )
      );
      const pluginDispose = module.activate(context);
      if (typeof pluginDispose !== "function") {
        throw new Error(
          `renderer plugin activate must return a disposer: ${pluginId}`
        );
      }
      scope.add(pluginDispose);
      const unresolvedPanels =
        this.externalPanelPlaceholders.unresolvedPanelIds(entry);
      if (unresolvedPanels.length > 0) {
        throw new Error(
          `renderer plugin did not register declared panels: ${unresolvedPanels.join(", ")}`
        );
      }
      if (!this.isCurrentExternalAttempt(pluginId, signature, token)) {
        scope.dispose();
        this.externalPanelPlaceholders.sync(this.desired);
        return;
      }
      this.active.set(pluginId, {
        dispose: () => scope.dispose(),
        kind: "external",
        signature,
        state: "active",
      });
      this.externalDiagnosticPluginIds.delete(pluginId);
      clearRendererPluginRuntimeDiagnostic(pluginId);
    } catch (error) {
      let failure: unknown = error;
      if (activationScope) {
        try {
          activationScope.dispose();
        } catch (cleanupError) {
          failure = new AggregateError(
            [error, cleanupError],
            `renderer plugin activation and cleanup failed: ${pluginId}`
          );
        }
      }
      if (!this.disposed) {
        this.externalPanelPlaceholders.sync(this.desired);
      }
      if (!this.isCurrentExternalAttempt(pluginId, signature, token)) {
        console.error(
          `[renderer-plugin-runtime] stale external ${pluginId} cleanup failed:`,
          failure
        );
        return;
      }
      const message =
        failure instanceof Error ? failure.message : String(failure);
      this.externalDiagnosticPluginIds.add(pluginId);
      reportRendererPluginRuntimeDiagnostic({
        message,
        pluginId,
      });
      console.error(
        `[renderer-plugin-runtime] external ${pluginId} failed: ${message}`
      );
    } finally {
      if (this.pendingExternal.get(pluginId)?.token === token) {
        this.pendingExternal.delete(pluginId);
      }
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.transitionTail.then(operation, operation);
    this.transitionTail = result.then(
      () => {
        this.lastTransitionError = null;
      },
      (error: unknown) => {
        this.lastTransitionError =
          error instanceof Error ? error : new Error(String(error));
      }
    );
    return result;
  }

  private reconcileLatestDesired(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const generation = this.refreshGeneration;
    const desired = new Map(this.desired);
    return this.enqueue(() => this.reconcileCore(desired, generation)).then(
      () => {
        this.startExternalActivations();
      },
      (error: unknown) => {
        this.startExternalActivations();
        throw error;
      }
    );
  }

  private async reconcileCore(
    desired: ReadonlyMap<string, PluginRegistryEntry>,
    generation: number
  ): Promise<void> {
    if (!this.isCurrentRefresh(generation)) {
      return;
    }
    this.externalPanelPlaceholders.sync(desired);
    const failures: unknown[] = [];
    for (const [pluginId, active] of [...this.active]) {
      if (!this.isCurrentRefresh(generation)) {
        return;
      }
      const entry = desired.get(pluginId);
      try {
        if (
          entry &&
          active.signature === runtimeEntrySignature(entry) &&
          active.state === "active"
        ) {
          await pluginLifecycleBarriers.abortReceipt(
            pluginId,
            "runtime-refresh"
          );
          continue;
        }
        await this.suspendAndDispose(pluginId, "runtime-refresh", () =>
          this.isCurrentRefresh(generation)
        );
      } catch (error) {
        if (pluginLifecycleBarriers.isPluginDraining(pluginId)) {
          this.drainRetries.schedule(
            pluginId,
            () => pluginLifecycleBarriers.waitForPluginDrain(pluginId),
            () => {
              this.reconcileLatestDesired().catch((error: unknown) => {
                console.error(
                  "[renderer-plugin-runtime] drain retry failed:",
                  error
                );
              });
            }
          );
          continue;
        }
        failures.push(error);
        if (active.kind === "external") {
          const message =
            error instanceof Error ? error.message : String(error);
          this.externalDiagnosticPluginIds.add(pluginId);
          reportRendererPluginRuntimeDiagnostic({ message, pluginId });
        }
      }
      if (!this.isCurrentRefresh(generation)) {
        return;
      }
    }
    for (const entry of desired.values()) {
      if (!this.isCurrentRefresh(generation)) {
        return;
      }
      if (
        entry.runtime.kind !== "builtin" ||
        this.active.has(entry.manifest.id)
      ) {
        continue;
      }
      try {
        const dispose = this.activateBuiltin(entry);
        if (dispose) {
          if (!this.isCurrentRefresh(generation)) {
            dispose();
            return;
          }
          this.active.set(entry.manifest.id, {
            dispose,
            kind: "builtin",
            signature: runtimeEntrySignature(entry),
            state: "active",
          });
        }
      } catch (error) {
        failures.push(error);
      }
    }
    this.externalPanelPlaceholders.sync(desired);
    if (failures.length > 0) {
      throw new AggregateError(failures, "renderer plugin refresh failed");
    }
  }

  private isCurrentRefresh(generation: number): boolean {
    return !this.disposed && this.refreshGeneration === generation;
  }

  private isCurrentExternalAttempt(
    pluginId: string,
    signature: string,
    token: symbol
  ): boolean {
    const pending = this.pendingExternal.get(pluginId);
    const desired = this.desired.get(pluginId);
    return (
      !this.disposed &&
      pending?.token === token &&
      pending.signature === signature &&
      desired?.runtime.kind === "external" &&
      runtimeEntrySignature(desired) === signature
    );
  }

  private startExternalActivation(entry: PluginRegistryEntry): void {
    const pluginId = entry.manifest.id;
    const signature = runtimeEntrySignature(entry);
    const token = Symbol(pluginId);
    this.pendingExternal.set(pluginId, {
      abortController: new AbortController(),
      signature,
      token,
    });
    this.activateExternalAttempt(entry, signature, token).catch((error) => {
      console.error(
        `[renderer-plugin-runtime] external ${pluginId} attempt failed:`,
        error
      );
    });
  }

  private async suspendAndDispose(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    shouldContinue: () => boolean = () => true
  ): Promise<void> {
    await suspendAndDisposeOwnedRendererPlugin({
      active: this.active,
      mainAuthorization: this.mainDisposalAuthorizations.get(pluginId),
      pluginId,
      reason,
      shouldContinue,
    });
    if (!this.active.has(pluginId)) {
      this.mainDisposalAuthorizations.remove(pluginId);
    }
  }
}

export const rendererPluginRuntime = new RendererPluginRuntime();
