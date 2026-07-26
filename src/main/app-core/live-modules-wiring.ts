import { createWiredLiveModulesService } from "../services/live-modules/bootstrap-service.ts";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import { broadcastLiveModulesChanged } from "./window-broadcasts.ts";

export function createAppLiveModulesService(input: {
  resolveHomeRoot: () => string;
}): LiveModulesService {
  return createWiredLiveModulesService({
    broadcast: broadcastLiveModulesChanged,
    resolveHomeRoot: input.resolveHomeRoot,
  });
}
