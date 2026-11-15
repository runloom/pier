import { protocol as electronProtocol } from "electron";
import { installCsp } from "./csp.ts";
import {
  handleHtmlPreviewProtocol,
  htmlPreviewSchemeRegistration,
} from "./files/html-preview-protocol.ts";
import {
  filePreviewSchemeRegistration,
  handleFilePreviewProtocol,
} from "./files/preview-protocol.ts";
import { registerPreviewRequestGuards } from "./files/preview-request-guard.ts";
import {
  assetSchemeRegistration,
  handleAssetProtocol,
} from "./fonts/asset-protocol.ts";
import {
  attachLiveModuleProtocolHandler,
  liveModuleSchemeRegistration,
} from "./live-modules/install-protocol.ts";
import {
  handlePluginAssetProtocol,
  pluginAssetSchemeRegistration,
} from "./plugins/asset-protocol.ts";
import type { ManagedPluginRuntimeSource } from "./services/managed-plugins/install-runtime.ts";

/**
 * Register privileged custom schemes before `app.whenReady()`.
 *
 * Electron replaces the privileged scheme list on every call, so all schemes
 * must go through one `registerSchemesAsPrivileged` call. Registering them in
 * separate calls leaves only the last batch with fetch/stream privileges.
 */
export function registerPrivilegedProtocolSchemes(): void {
  electronProtocol.registerSchemesAsPrivileged([
    assetSchemeRegistration(),
    pluginAssetSchemeRegistration(),
    filePreviewSchemeRegistration(),
    htmlPreviewSchemeRegistration(),
    liveModuleSchemeRegistration(),
  ]);
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
