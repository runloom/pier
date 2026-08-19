import type { ProjectsSettingsTab } from "@/pages/settings/data/projects-settings.ts";
import { leavePierHomeSkillsTransientState } from "../pier-home-skills-panel.tsx";
import {
  leaveSkillsTransientState,
  type Translate,
} from "../skills/shared.tsx";

export { isPierHomeSkillsDirty } from "../pier-home-skills-panel.tsx";

export async function leaveAllSkillsTransientState(
  t: Translate
): Promise<boolean> {
  if (!(await leavePierHomeSkillsTransientState(t))) {
    return false;
  }
  return leaveSkillsTransientState(t);
}

const PATH_SEPARATOR_RE = /[\\/]/;

/** Rules tab is deferred product-wide (Skills + MCP only for now). */
export function isTabAllowedForProject(
  tab: ProjectsSettingsTab,
  isPierHome: boolean
): boolean {
  if (tab === "rules" || tab === "materials") return false;
  if (!isPierHome) return true;
  // Home: skills library + MCP. No environment / general / materials.
  return tab === "skills" || tab === "mcp";
}

export function defaultTabFor(isPierHome: boolean): ProjectsSettingsTab {
  return isPierHome ? "skills" : "environment";
}

export function projectBasename(projectRootPath: string): string {
  return (
    projectRootPath.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
    projectRootPath
  );
}
