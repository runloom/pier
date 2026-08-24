import type { CanvasTrustService } from "../services/canvas-trust/service.ts";
import { createWiredLiveModulesService } from "../services/live-modules/bootstrap-service.ts";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import { broadcastLiveModulesChanged } from "./window-broadcasts.ts";

export function createAppLiveModulesService(input: {
  resolveHomeRoot: () => string;
  projectTrust?: CanvasTrustService;
}): LiveModulesService {
  const { projectTrust } = input;
  return createWiredLiveModulesService({
    broadcast: broadcastLiveModulesChanged,
    resolveHomeRoot: input.resolveHomeRoot,
    ...(projectTrust
      ? {
          resolveProjectTrust: (projectRootPath: string) =>
            projectTrust.status(projectRootPath).then((s) => s.trusted),
        }
      : {}),
  });
}
