import type { MainPluginHostApi } from "../plugins/host-api.ts";
import type { PierClientRegistry } from "./client-registry.ts";
import type { CommandRouter, PierCoreServices } from "./command-router.ts";
import type { PierEventBus } from "./event-bus.ts";

export interface PierAppCore {
  clients: PierClientRegistry;
  commandRouter: CommandRouter;
  disposeManagedPluginDevRuntimeWatch(): void;
  disposePluginDataProjections(): void;
  eventBus: PierEventBus;
  flushExternalPluginsBeforeQuit(): Promise<void>;
  pluginHost: MainPluginHostApi;
  ready: Promise<void>;
  services: PierCoreServices;
}
