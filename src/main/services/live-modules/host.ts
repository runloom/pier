import type { LiveModulesService } from "./service.ts";

let liveModulesService: LiveModulesService | null = null;

export function setLiveModulesService(
  service: LiveModulesService | null
): void {
  liveModulesService = service;
}

export function getLiveModulesService(): LiveModulesService | null {
  return liveModulesService;
}
