import { pathToFileURL } from "node:url";
import type { ManagedPluginRuntimeSource } from "../services/managed-plugins/install-runtime.ts";
import type { PluginRpcBus } from "./plugin-rpc-bus.ts";

/**
 * External main plugin runtime (plan Task 5).
 * Dynamically `import()`s an installed plugin's `dist/main.js` from
 * `file://.../installed/<id>/<version>/dist/main.js`, calls `activate(context)`,
 * stores disposer, and reports activation success/failure back to the install
 * service via `recordActivationResult`.
 *
 * The dynamic import here is legitimate: plugin path is runtime-selected from
 * the install index, not known at author time.
 */

export interface ExternalMainPluginModule {
  activate(
    context: ExternalMainPluginContext
  ): (() => void) | Promise<() => void>;
  id: string;
}

export interface ExternalMainPluginContext {
  events: {
    emit(event: string, payload: unknown): void;
  };
  legacyCodexAccounts?: {
    readonly legacyAgentAccountsBaseDir: string;
    readonly legacyAgentAccountsStateFile: string;
    readLegacyAuthJson(accountId: string): Promise<string | null>;
    readLegacySecretsStoreEntry(key: string): Promise<string | null>;
    readLegacyStateFile(): Promise<string | null>;
  };
  lifecycle: {
    onBeforeQuit(callback: () => Promise<void> | void): void;
  };
  logger: {
    debug(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  paths: {
    dataDir: string;
    workDir: string;
  };
  plugin: {
    id: string;
    version: string;
  };
  rpc: {
    handle(
      method: string,
      handler: (payload: unknown) => Promise<unknown>
    ): void;
  };
}

export interface RecordActivationResultInput {
  readonly ok: boolean;
  readonly phase: "main" | "renderer";
  readonly pluginId: string;
  readonly version: string;
  readonly windowId?: string;
}

export const PLUGIN_BEFORE_QUIT_TIMEOUT_MS = 5000;

export interface ExternalMainPluginRuntime {
  activate(source: ManagedPluginRuntimeSource): Promise<void>;
  dispose(pluginId: string): Promise<void>;
  disposeAll(): Promise<void>;
  flushAllBeforeQuit(): Promise<void>;
  reload(source: ManagedPluginRuntimeSource): Promise<void>;
}

export function createExternalMainPluginRuntime(options: {
  createContext: (
    source: ManagedPluginRuntimeSource
  ) => ExternalMainPluginContext;
  importModule?: (moduleUrl: string) => Promise<unknown>;
  recordActivationResult: (input: RecordActivationResultInput) => Promise<void>;
  rpcBus: PluginRpcBus;
}): ExternalMainPluginRuntime {
  const disposers: Record<string, () => void> = {};
  const flushCallbacks: Record<string, Array<() => Promise<void> | void>> = {};
  const importModule =
    options.importModule ??
    ((moduleUrl: string) => import(/* @vite-ignore */ moduleUrl));

  async function flushPluginCallbacks(
    pluginId: string,
    callbacks: ReadonlyArray<() => Promise<void> | void>
  ): Promise<void> {
    const results = await Promise.allSettled(
      callbacks.map(
        (cb) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("before-quit flush timeout")),
              PLUGIN_BEFORE_QUIT_TIMEOUT_MS
            );
            Promise.resolve()
              .then(cb)
              .then(resolve, reject)
              .finally(() => clearTimeout(timer));
          })
      )
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `external plugin flush failed: ${pluginId}`
      );
    }
  }

  async function disposePlugin(pluginId: string): Promise<void> {
    const callbacks = flushCallbacks[pluginId] ?? [];
    await flushPluginCallbacks(pluginId, callbacks);
    const disposer = disposers[pluginId];
    if (disposer) {
      try {
        disposer();
      } catch (err) {
        console.error(
          `[external-main-runtime] dispose failed for ${pluginId}:`,
          err
        );
      }
    }
    options.rpcBus.clearPlugin(pluginId);
    delete disposers[pluginId];
    delete flushCallbacks[pluginId];
  }

  function moduleUrlForSource(source: ManagedPluginRuntimeSource): string {
    const moduleUrl = pathToFileURL(source.mainEntryPath);
    if (source.sourceRevision) {
      moduleUrl.searchParams.set("rev", source.sourceRevision);
    }
    return moduleUrl.href;
  }

  return {
    async activate(source): Promise<void> {
      const context = options.createContext(source);
      // Register a lifecycle sink so plugin main can register before-quit flushers.
      const collectedFlushers: Array<() => Promise<void> | void> = [];
      const contextWithLifecycle: ExternalMainPluginContext = {
        ...context,
        lifecycle: {
          onBeforeQuit: (cb) => collectedFlushers.push(cb),
        },
        rpc: {
          handle: (method, handler) =>
            options.rpcBus.handle(source.id, method, handler),
        },
      };
      try {
        const moduleUrl = moduleUrlForSource(source);
        const mod: unknown = await importModule(moduleUrl);
        if (!mod || typeof mod !== "object" || !("plugin" in mod)) {
          throw new Error(`plugin export missing in ${source.mainEntryPath}`);
        }
        const pluginExport: unknown = mod.plugin;
        if (
          !pluginExport ||
          typeof pluginExport !== "object" ||
          !("id" in pluginExport) ||
          !("activate" in pluginExport) ||
          typeof pluginExport.id !== "string" ||
          typeof pluginExport.activate !== "function" ||
          pluginExport.id !== source.id
        ) {
          throw new Error(
            `plugin export invalid in ${source.mainEntryPath}: expected id ${source.id}`
          );
        }
        // Narrowing above proves shape — this is a well-known contract, not raw input.
        const plugin = pluginExport as ExternalMainPluginModule;
        const disposer = await plugin.activate(contextWithLifecycle);
        disposers[source.id] = disposer;
        flushCallbacks[source.id] = collectedFlushers;
        await options.recordActivationResult({
          ok: true,
          phase: "main",
          pluginId: source.id,
          version: source.version,
        });
      } catch (err) {
        context.logger.error(
          `external main activation failed for ${source.id}: ${(err as Error).message}`
        );
        await options.recordActivationResult({
          ok: false,
          phase: "main",
          pluginId: source.id,
          version: source.version,
        });
      }
    },
    dispose: (pluginId) => disposePlugin(pluginId),
    async disposeAll(): Promise<void> {
      for (const id of Object.keys(disposers)) {
        await disposePlugin(id);
      }
    },
    async flushAllBeforeQuit(): Promise<void> {
      const tasks: Promise<void>[] = [];
      for (const [pluginId, callbacks] of Object.entries(flushCallbacks)) {
        tasks.push(flushPluginCallbacks(pluginId, callbacks));
      }
      await Promise.all(tasks);
    },
    async reload(source): Promise<void> {
      await disposePlugin(source.id);
      await this.activate(source);
    },
  };
}
