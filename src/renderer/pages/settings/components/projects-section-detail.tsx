import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
import { ArrowLeft } from "lucide-react";
import type { RefObject } from "react";
import type { useT } from "@/i18n/use-t.ts";
import type { ProjectsSettingsTab } from "@/pages/settings/data/projects-settings.ts";
import {
  EnvironmentEditor,
  type EnvironmentEditorHandle,
} from "./environment-editor.tsx";
import { PierHomeSkillsPanel } from "./pier-home-skills-panel.tsx";
import { ProjectGeneralPanel } from "./project-general-panel.tsx";
import { ProjectMcpPanel } from "./project-mcp-panel.tsx";
import {
  defaultTabFor,
  isTabAllowedForProject,
  projectBasename,
} from "./projects-section-helpers.ts";
import { SkillsAddMenu } from "./skills/add-menu.tsx";
import { SkillsSection } from "./skills-section.tsx";

export function ProjectsSectionDetail({
  activeProjectRootPath,
  editorRef,
  envDirty,
  focused,
  onBack,
  onDelete,
  onDirtyChange,
  onTabChange,
  projectsTab,
  skillsModeKind,
  t,
  triggerEnvSave,
}: {
  activeProjectRootPath: string | null;
  editorRef: RefObject<EnvironmentEditorHandle | null>;
  envDirty: boolean;
  focused: LocalEnvironmentProject;
  onBack: () => void;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onTabChange: (next: string) => void;
  projectsTab: ProjectsSettingsTab;
  skillsModeKind: string;
  t: ReturnType<typeof useT>;
  triggerEnvSave: () => void;
}) {
  const isPierHome = focused.kind === "pier-home";
  const activeTab = isTabAllowedForProject(projectsTab, isPierHome)
    ? projectsTab
    : defaultTabFor(isPierHome);
  const detailKey = `${focused.projectRootPath}:${focused.kind}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-col px-4 pb-2" id="projects">
      <div className="mb-4 flex items-center gap-3">
        <Button
          aria-label={t("settings.projects.back")}
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-xl">
              {isPierHome
                ? t("settings.projects.pierHomeTitle")
                : projectBasename(focused.projectRootPath)}
            </h1>
            {isPierHome ? (
              <Badge variant="secondary">
                {t("settings.projects.pierHomeBadge")}
              </Badge>
            ) : null}
            {!isPierHome &&
            focused.projectRootPath === activeProjectRootPath ? (
              <Badge variant="secondary">
                {t("settings.skills.currentBadge")}
              </Badge>
            ) : null}
          </div>
          <span className="truncate text-muted-foreground text-xs">
            {isPierHome
              ? t("settings.projects.pierHomePathHint")
              : focused.projectRootPath}
          </span>
        </div>
      </div>

      <Tabs
        className="gap-1"
        key={detailKey}
        onValueChange={onTabChange}
        value={activeTab}
      >
        <div className="sticky top-0 isolate z-10 -mx-4 bg-background px-4 pb-1">
          <div className="flex items-center justify-between gap-3">
            <TabsList className="gap-3" variant="line">
              {isPierHome ? null : (
                <TabsTrigger value="environment">
                  {t("settings.projects.tabEnvironment")}
                </TabsTrigger>
              )}
              <TabsTrigger value="skills">
                {t("settings.projects.tabSkills")}
              </TabsTrigger>
              <TabsTrigger value="mcp">
                {t("settings.projects.tabMcp")}
              </TabsTrigger>
              {isPierHome ? null : (
                <TabsTrigger value="general">
                  {t("settings.projects.tabGeneral")}
                </TabsTrigger>
              )}
            </TabsList>
            {activeTab === "environment" && envDirty && !isPierHome ? (
              <Button onClick={triggerEnvSave} size="sm" type="button">
                {t("settings.environment.save")}
              </Button>
            ) : null}
            {!isPierHome &&
            activeTab === "skills" &&
            skillsModeKind === "detail" ? (
              <SkillsAddMenu />
            ) : null}
          </div>
        </div>
        <div className="min-w-0 pt-2">
          {activeTab === "environment" && !isPierHome ? (
            <EnvironmentEditor
              key={focused.projectRootPath}
              onDirtyChange={onDirtyChange}
              project={focused}
              ref={editorRef}
            />
          ) : null}
          {activeTab === "skills" && isPierHome ? (
            <PierHomeSkillsPanel
              key={`home-skills:${focused.projectRootPath}`}
            />
          ) : null}
          {activeTab === "skills" && !isPierHome ? (
            <SkillsSection
              embedded={{
                onLeaveProject: onBack,
                projectRootPath: focused.projectRootPath,
              }}
              key={`skills:${focused.projectRootPath}`}
            />
          ) : null}
          {activeTab === "mcp" ? (
            <ProjectMcpPanel
              isPierHome={isPierHome}
              key={`mcp:${focused.projectRootPath}`}
              projectRootPath={focused.projectRootPath}
            />
          ) : null}
          {activeTab === "general" && !isPierHome ? (
            <ProjectGeneralPanel
              onDelete={onDelete}
              projectRootPath={focused.projectRootPath}
            />
          ) : null}
        </div>
      </Tabs>
    </div>
  );
}
