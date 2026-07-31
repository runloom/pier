import { join } from "node:path";

/**
 * Absolute directory of all bundled system skills under an Electron resources
 * root (`…/resources` in dev, `process.resourcesPath` in prod).
 *
 * Callers own dev/prod root selection (see `app-core.ts` + `isDevRuntime()`),
 * matching fonts/sounds packaging layout where extraResources land at
 * `{resourcesRoot}/system-skills`.
 */
export function systemSkillsRootDir(resourcesRoot: string): string {
  return join(resourcesRoot, "system-skills");
}

/** Absolute content directory for one system skill id. */
export function systemSkillContentDir(
  resourcesRoot: string,
  skillId: string
): string {
  return join(systemSkillsRootDir(resourcesRoot), skillId);
}
