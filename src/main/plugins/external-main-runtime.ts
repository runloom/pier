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
  disposeAll(): Promise<void>;
  flushAllBeforeQuit(): Promise<void>;
}

export function createExternalMainPluginRuntime(options: {
  createContext: (
    source: ManagedPluginRuntimeSource
  ) => ExternalMainPluginContext;
  recordActivationResult: (input: RecordActivationResultInput) => Promise<void>;
  rpcBus: PluginRpcBus;
}): ExternalMainPluginRuntime {
  const disposers: Record<string, () => void> = {};
  const flushCallbacks: Record<string, Array<() => Promise<void> | void>> = {};

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
        const moduleUrl = pathToFileURL(source.mainEntryPath).href;
        const mod: unknown = await import(moduleUrl);
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
    async disposeAll(): Promise<void> {
      for (const [id, disposer] of Object.entries(disposers)) {
        try {
          disposer();
        } catch (err) {
          console.error(
            `[external-main-runtime] dispose failed for ${id}:`,
            err
          );
        }
        options.rpcBus.clearPlugin(id);
      }
      for (const key of Object.keys(disposers)) {
        delete disposers[key];
      }
      for (const key of Object.keys(flushCallbacks)) {
        delete flushCallbacks[key];
      }
    },
    async flushAllBeforeQuit(): Promise<void> {
      const tasks: Promise<void>[] = [];
      for (const [pluginId, callbacks] of Object.entries(flushCallbacks)) {
        for (const cb of callbacks) {
          tasks.push(
            (async () => {
              try {
                await Promise.race([
                  Promise.resolve(cb()),
                  new Promise<void>((_, reject) =>
                    setTimeout(
                      () => reject(new Error("before-quit flush timeout")),
                      PLUGIN_BEFORE_QUIT_TIMEOUT_MS
                    )
                  ),
                ]);
              } catch (err) {
                console.error(
                  `[external-main-runtime] before-quit flush failed for ${pluginId}:`,
                  err
                );
              }
            })()
          );
        }
      }
      await Promise.all(tasks);
    },
  };
}
