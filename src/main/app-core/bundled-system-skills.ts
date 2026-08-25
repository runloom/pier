import { systemSkillContentDir } from "../services/project-skills/system-skills/asset-paths.ts";
import type { SystemSkillContribution } from "../services/project-skills/system-skills/index.ts";

/** Canonical id for the bundled Pier Canvas authoring skill. */
export const PIER_CANVAS_SYSTEM_SKILL_ID = "pier-canvas";

/** Canonical id for the bundled subagent panel delegation skill. */
export const PIER_SUBAGENT_PANELS_SYSTEM_SKILL_ID = "pier-subagent-panels";

/**
 * Application-owned system skills shipped as immutable Electron resources and
 * injected per project through the system-skills channel (design v8 §8).
 *
 * Only register skills that exist under `resources/system-skills/<id>/`.
 *
 * `pier-subagent-panels` uses agent-aware content: Claude Code (teams preset
 * active) reads "use native teammate spawning"; all other agents read
 * "use `pier agents start` delegation CLI". This prevents the skill from
 * hijacking teams-mode flows while still teaching non-tmux agents about
 * delegation.
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
    {
      id: PIER_SUBAGENT_PANELS_SYSTEM_SKILL_ID,
      contentDir: systemSkillContentDir(
        input.resourcesRoot,
        PIER_SUBAGENT_PANELS_SYSTEM_SKILL_ID
      ),
      provider: {
        id: "pier.app",
        version: input.appVersion,
      },
    },
  ];
}
