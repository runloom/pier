/**
 * `pier-live://` protocol registration (Electron).
 */

import { LIVE_MODULE_SCHEME } from "@shared/live-module-url.ts";
import { protocol } from "electron";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import { createLiveModuleProtocolHandler } from "./live-module-protocol-handler.ts";

export { createLiveModuleProtocolHandler } from "./live-module-protocol-handler.ts";

export function registerLiveModuleScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
      scheme: LIVE_MODULE_SCHEME,
    },
  ]);
}

export function handleLiveModuleProtocol(
  getService: () => LiveModulesService | null
): void {
  protocol.handle(
    LIVE_MODULE_SCHEME,
    createLiveModuleProtocolHandler(getService)
  );
}
