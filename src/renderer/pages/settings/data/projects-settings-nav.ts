import type { SettingsSectionId } from "@/pages/settings/data/appearance-nav.ts";
import {
  PROJECTS_SECTION_ID,
  type ProjectsSettingsTab,
  projectsTabFromSection,
  resolveProjectsSectionId,
} from "@/pages/settings/data/projects-settings.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

export type { ProjectsSettingsTab } from "@/pages/settings/data/projects-settings.ts";

function normalizeSection(section: SettingsSectionId): {
  section: SettingsSectionId;
  projectsTab: ProjectsSettingsTab | null;
} {
  const resolved = resolveProjectsSectionId(section);
  if (!resolved) {
    return { section, projectsTab: null };
  }
  return {
    section: PROJECTS_SECTION_ID,
    projectsTab: projectsTabFromSection(section) ?? null,
  };
}

/**
 * Open settings on the projects shell. Legacy `environment` / `skills`
 * section ids still work and select the matching tab.
 */
export function openProjectsSettings(args?: {
  tab?: ProjectsSettingsTab;
  /** Open Pier Home instead of a repo project. */
  focusHome?: boolean;
  /** Prefer opening this project when present in the shared index. */
  projectRootPath?: string;
}): void {
  const tab = args?.tab ?? "skills";
  const focusHome = args?.focusHome === true;
  useSettingsDialogStore.setState({
    projectsTab: tab,
    projectsFocusHome: focusHome,
    projectsFocusPath: focusHome ? null : (args?.projectRootPath ?? null),
  });
  useSettingsDialogStore.getState().openSection(PROJECTS_SECTION_ID);
}

export function applyProjectsSectionAlias(
  section: SettingsSectionId
): SettingsSectionId {
  return normalizeSection(section).section;
}

export function consumeProjectsTabAlias(
  section: SettingsSectionId
): ProjectsSettingsTab | null {
  return normalizeSection(section).projectsTab;
}
