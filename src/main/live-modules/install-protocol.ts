import { getLiveModulesService } from "../services/live-modules/host.ts";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import {
  handleLiveModuleProtocol,
  registerLiveModuleScheme,
} from "./protocol.ts";

/** Privileged scheme registration (before app.whenReady). */
export function registerLiveModuleProtocolScheme(): void {
  registerLiveModuleScheme();
}

/** Protocol handler (after app.whenReady). Defaults to host service lookup. */
export function attachLiveModuleProtocolHandler(
  getService: () => LiveModulesService | null = getLiveModulesService
): void {
  handleLiveModuleProtocol(getService);
}
