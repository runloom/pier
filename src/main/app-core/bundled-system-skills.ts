import { systemSkillContentDir } from "../services/project-skills/system-skill-asset-paths.ts";
import type { SystemSkillContribution } from "../services/project-skills/system-skills.ts";

/** Canonical id for the bundled Pier Canvas authoring skill. */
export const PIER_CANVAS_SYSTEM_SKILL_ID = "pier-canvas";

/**
 * Application-owned system skills shipped as immutable Electron resources and
 * injected per project through the system-skills channel (design v8 §8).
 *
 * Only register skills that exist under `resources/system-skills/<id>/`.
 * Do not register multi-agent collaboration skills here.
 */
export function bundledSystemSkillContributions(input: {
  appVersion: string;
  resourcesRoot: string;
}): readonly SystemSkillContribution[] {
  return [
    {
      id: PIER_CANVAS_SYSTEM_SKILL_ID,
      contentDir: systemSkillContentDir(
        input.resourcesRoot,
        PIER_CANVAS_SYSTEM_SKILL_ID
      ),
      provider: {
        id: "pier.app",
        version: input.appVersion,
      },
    },
  ];
}
