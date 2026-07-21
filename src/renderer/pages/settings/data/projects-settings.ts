/**
 * Project settings shell: one settings nav entry owns the shared project
 * index; Environment, Skills, and General are tabs inside a selected project.
 *
 * Structure-first (before delivery multi-target config):
 * - Nav id: `projects` (aliases: `environment`, `skills` → same section + tab)
 * - List → project detail → Environment | Skills | General
 * - Domain stores/commands stay split (local-environments vs project-skills)
 */
export type ProjectsSettingsTab = "environment" | "skills" | "general";

export const PROJECTS_SECTION_ID = "projects" as const;

/** Legacy section ids that deep-link into the projects shell. */
export const PROJECTS_SECTION_ALIASES = ["environment", "skills"] as const;

export function resolveProjectsSectionId(
  section: string
): typeof PROJECTS_SECTION_ID | null {
  if (section === PROJECTS_SECTION_ID) {
    return PROJECTS_SECTION_ID;
  }
  if ((PROJECTS_SECTION_ALIASES as readonly string[]).includes(section)) {
    return PROJECTS_SECTION_ID;
  }
  return null;
}

export function projectsTabFromSection(
  section: string
): ProjectsSettingsTab | null {
  if (section === "environment") return "environment";
  if (section === "skills") return "skills";
  return null;
}
