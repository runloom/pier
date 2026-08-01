import { installCsp } from "./csp.ts";
import {
  handleFilePreviewProtocol,
  registerFilePreviewRequestGuard,
  registerFilePreviewScheme,
} from "./files/preview-protocol.ts";
import {
  handleAssetProtocol,
  registerAssetScheme,
} from "./fonts/asset-protocol.ts";
import {
  attachLiveModuleProtocolHandler,
  registerLiveModuleProtocolScheme,
} from "./live-modules/install-protocol.ts";
import {
  handlePluginAssetProtocol,
  registerPluginAssetScheme,
} from "./plugins/asset-protocol.ts";
import type { ManagedPluginRuntimeSource } from "./services/managed-plugins/install-runtime.ts";

/** Register privileged custom schemes before `app.whenReady()`. */
export function registerPrivilegedProtocolSchemes(): void {
  registerAssetScheme();
  registerPluginAssetScheme();
  registerFilePreviewScheme();
  registerLiveModuleProtocolScheme();
}

/** Attach protocol handlers after `app.whenReady()`. */
export function attachPrivilegedProtocolHandlers(input: {
  getPluginRuntimeSources: () => readonly ManagedPluginRuntimeSource[];
}): void {
  installCsp();
  handleAssetProtocol();
  registerFilePreviewRequestGuard();
  handleFilePreviewProtocol();
  attachLiveModuleProtocolHandler();
  handlePluginAssetProtocol({
    getRuntimeSources: input.getPluginRuntimeSources,
  });
}
