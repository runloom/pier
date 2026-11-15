/**
 * `pier-live://` protocol registration (Electron).
 */

import { LIVE_MODULE_SCHEME } from "@shared/live-module-url.ts";
import { protocol } from "electron";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import { createLiveModuleProtocolHandler } from "./protocol-handler.ts";

export { createLiveModuleProtocolHandler } from "./protocol-handler.ts";

export function liveModuleSchemeRegistration(): {
  privileges: {
    corsEnabled: boolean;
    secure: boolean;
    standard: boolean;
    supportFetchAPI: boolean;
  };
  scheme: typeof LIVE_MODULE_SCHEME;
} {
  return {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: LIVE_MODULE_SCHEME,
  };
}

export function registerLiveModuleScheme(): void {
  protocol.registerSchemesAsPrivileged([liveModuleSchemeRegistration()]);
}

export function handleLiveModuleProtocol(
  getService: () => LiveModulesService | null
): void {
  protocol.handle(
    LIVE_MODULE_SCHEME,
    createLiveModuleProtocolHandler(getService)
  );
}
