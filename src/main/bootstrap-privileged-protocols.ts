import { installCsp } from "./csp.ts";
import {
  handleHtmlPreviewProtocol,
  registerHtmlPreviewScheme,
} from "./files/html-preview-protocol.ts";
import {
  handleFilePreviewProtocol,
  registerFilePreviewScheme,
} from "./files/preview-protocol.ts";
import { registerPreviewRequestGuards } from "./files/preview-request-guard.ts";
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
  registerHtmlPreviewScheme();
  registerLiveModuleProtocolScheme();
}

/** Attach protocol handlers after `app.whenReady()`. */
export function attachPrivilegedProtocolHandlers(input: {
  getPluginRuntimeSources: () => readonly ManagedPluginRuntimeSource[];
}): void {
  installCsp();
  handleAssetProtocol();
  registerPreviewRequestGuards();
  handleFilePreviewProtocol();
  handleHtmlPreviewProtocol();
  attachLiveModuleProtocolHandler();
  handlePluginAssetProtocol({
    getRuntimeSources: input.getPluginRuntimeSources,
  });
}
