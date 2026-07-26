import type { LiveModuleEvent } from "@shared/contracts/live-modules.ts";
import { setLiveModulesService } from "./host.ts";
import {
  createLiveModulesService,
  type LiveModulesService,
} from "./service.ts";

/** Create Live Modules service and publish it for the pier-live protocol handler. */
export function createWiredLiveModulesService(input: {
  broadcast?: (event: LiveModuleEvent) => void;
  resolveHomeRoot: () => string;
}): LiveModulesService {
  const liveModules = createLiveModulesService(input);
  setLiveModulesService(liveModules);
  return liveModules;
}
