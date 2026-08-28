/**
 * Project settings shell: one settings nav entry owns the shared project
 * index; Environment, Skills, MCP, and General are tabs inside a selected
 * project. Canvas materials are a kit canvas, not a settings tab. Rules and
 * the former materials tab id are kept for persisted values only.
 *
 * - Nav id: `projects` (aliases: `environment`, `skills`, `materials`)
 * - List → project detail → Environment | Skills | MCP | General
 * - Home detail → Skills | MCP
 * - Domain stores/commands stay split (local-environments vs project-skills)
 */
const HOST_PROJECTS_TABS = [
  "environment",
  "rules",
  "skills",
  "mcp",
  "general",
  "materials",
] as const;

export type HostProjectsSettingsTab = (typeof HOST_PROJECTS_TABS)[number];
/** Host tabs plus plugin `projectSettings` contribution ids. */
export type ProjectsSettingsTab = HostProjectsSettingsTab | string;

export function isHostProjectsTab(tab: string): tab is HostProjectsSettingsTab {
  return (HOST_PROJECTS_TABS as readonly string[]).includes(tab);
}

export const PROJECTS_SECTION_ID = "projects" as const;

/** Legacy / deep-link section ids that open the projects shell. */
export const PROJECTS_SECTION_ALIASES = [
  "environment",
  "skills",
  "materials",
] as const;

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
