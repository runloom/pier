import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import { ArrowLeft, FolderPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import type { ProjectsSettingsTab } from "@/pages/settings/data/projects-settings.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import {
  EnvironmentEditor,
  type EnvironmentEditorHandle,
} from "./environment-editor.tsx";
import { ProjectGeneralPanel } from "./project-general-panel.tsx";
import { ProjectsSectionList } from "./projects-section-list.tsx";
import { SkillsAddMenu } from "./skills/skills-add-menu.tsx";
import { leaveSkillsTransientState } from "./skills/skills-shared.tsx";
import { SkillsSection } from "./skills-section.tsx";

const PATH_SEPARATOR_RE = /[\\/]/;

function projectBasename(projectRootPath: string): string {
  return (
    projectRootPath.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
    projectRootPath
  );
}

/**
 * Unified project settings shell: shared project list, then Environment /
 * Skills / General tabs. Domain logic stays in environment + skills modules.
 */
export function ProjectsSection() {
  const t = useT();
  const projects = useLocalEnvironmentsStore((s) => s.projects);
  const worktreeBindings = useLocalEnvironmentsStore((s) => s.worktreeBindings);
  const addProject = useLocalEnvironmentsStore((s) => s.addProject);
  const removeProject = useLocalEnvironmentsStore((s) => s.removeProject);
  const activeProjectRootPath =
    useActiveDescriptor()?.context?.projectRootPath ?? null;

  const projectsTab = useSettingsDialogStore((s) => s.projectsTab);
  const setProjectsTab = useSettingsDialogStore((s) => s.setProjectsTab);
  const projectsFocusPath = useSettingsDialogStore((s) => s.projectsFocusPath);
  const clearProjectsFocusPath = useSettingsDialogStore(
    (s) => s.clearProjectsFocusPath
  );
  const registerSectionGuard = useSettingsDialogStore(
    (s) => s.registerSectionGuard
  );
  const skillsModeKind = useProjectSkillsStore((s) => s.mode.kind);
  const skillsProjects = useProjectSkillsStore((s) => s.projects);
  const loadSkillsProjects = useProjectSkillsStore((s) => s.loadProjects);

  const [selected, setSelected] = useState<string | null>(null);
  const [initializedFromActive, setInitializedFromActive] = useState(false);
  const [envDirty, setEnvDirty] = useState(false);
  const editorRef = useRef<EnvironmentEditorHandle | null>(null);

  useEffect(() => {
    if (selected) return;
    loadSkillsProjects().catch(() => undefined);
  }, [loadSkillsProjects, selected]);

  useEffect(() => {
    if (projectsFocusPath) {
      if (projects.some((p) => p.projectRootPath === projectsFocusPath)) {
        setSelected(projectsFocusPath);
      }
      clearProjectsFocusPath();
      return;
    }
    if (initializedFromActive || selected) {
      return;
    }
    if (
      activeProjectRootPath &&
      projects.some((p) => p.projectRootPath === activeProjectRootPath)
    ) {
      setSelected(activeProjectRootPath);
      setInitializedFromActive(true);
    }
  }, [
    activeProjectRootPath,
    clearProjectsFocusPath,
    initializedFromActive,
    projects,
    projectsFocusPath,
    selected,
  ]);

  useEffect(() => {
    if (selected && !projects.some((p) => p.projectRootPath === selected)) {
      setSelected(null);
    }
  }, [selected, projects]);

  const focused =
    selected === null
      ? null
      : (projects.find((p) => p.projectRootPath === selected) ?? null);

  const guardEnvDirty = useCallback(async (): Promise<boolean> => {
    if (!(envDirty && focused)) {
      return true;
    }
    return await showAppConfirm({
      body: t("settings.environment.discardBody", {
        name: projectBasename(focused.projectRootPath),
      }),
      intent: "destructive",
      size: "sm",
      title: t("settings.environment.discardTitle"),
    });
  }, [envDirty, focused, t]);

  useEffect(() => {
    registerSectionGuard("projects", {
      canLeave: () => {
        if (envDirty) return false;
        const state = useProjectSkillsStore.getState();
        return (
          Object.keys(state.editDraftBySkillId).length === 0 &&
          state.mode.kind !== "import-review" &&
          !state.planPending &&
          !state.applyPending &&
          !state.writesFrozen
        );
      },
      leave: async () => {
        // Confirm env discard first, but only clear envDirty after skills
        // leave also succeeds — otherwise a frozen apply would drop the
        // dirty bit and silently discard environment edits on the next leave.
        if (envDirty && !(await guardEnvDirty())) {
          return false;
        }
        if (!(await leaveSkillsTransientState(t))) {
          return false;
        }
        if (envDirty) {
          setEnvDirty(false);
        }
        return true;
      },
    });
    return () => {
      registerSectionGuard("projects", null);
    };
  }, [envDirty, guardEnvDirty, registerSectionGuard, t]);

  async function goBackToList() {
    if (!(await guardEnvDirty())) {
      return;
    }
    if (!(await leaveSkillsTransientState(t))) {
      return;
    }
    setEnvDirty(false);
    setSelected(null);
    useProjectSkillsStore.getState().selectProject(null);
  }

  function openProject(projectRootPath: string) {
    if (selected === projectRootPath) {
      return;
    }
    const state = useProjectSkillsStore.getState();
    const needsSkillsLeave =
      Object.keys(state.editDraftBySkillId).length > 0 ||
      state.mode.kind === "import-review" ||
      state.planPending ||
      state.applyPending ||
      state.writesFrozen;

    const switchTo = async (clearEnvDirty: boolean) => {
      if (needsSkillsLeave && !(await leaveSkillsTransientState(t))) {
        return;
      }
      if (clearEnvDirty) {
        setEnvDirty(false);
      }
      setSelected(projectRootPath);
    };

    // Keep the common (clean) path synchronous so list→detail works without
    // waiting on a microtask after click.
    if (!(envDirty || needsSkillsLeave)) {
      setSelected(projectRootPath);
      return;
    }
    if (envDirty) {
      guardEnvDirty()
        .then((ok) => {
          if (!ok) return;
          switchTo(true).catch(() => undefined);
        })
        .catch(() => undefined);
      return;
    }
    switchTo(false).catch(() => undefined);
  }

  async function addEnvironment() {
    try {
      const dir = await window.pier.environments.pickProjectDirectory();
      if (!dir) return;
      await addProject({ projectRootPath: dir });
      setSelected(dir);
    } catch (err) {
      await showAppAlert({
        title: t("settings.environment.addFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function requestDelete() {
    if (!focused) return;
    if (!(await leaveSkillsTransientState(t))) {
      return;
    }
    const name = projectBasename(focused.projectRootPath);
    const boundCount = worktreeBindings.filter(
      (b) => b.projectRootPath === focused.projectRootPath
    ).length;
    const ok = await showAppConfirm({
      body:
        boundCount > 0
          ? t("settings.projects.general.deleteConfirmBoundBody", {
              name,
              count: boundCount,
            })
          : t("settings.projects.general.deleteConfirmBody", { name }),
      intent: "destructive",
      size: "default",
      title: t("settings.projects.general.deleteConfirmTitle"),
    });
    if (!ok) return;
    try {
      await removeProject({ projectRootPath: focused.projectRootPath });
      setSelected(null);
      setEnvDirty(false);
    } catch (err) {
      await showAppAlert({
        title: t("settings.environment.deleteFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function triggerSave() {
    try {
      await editorRef.current?.save();
      toast.success(t("settings.environment.saveSuccess"));
    } catch (err) {
      await showAppAlert({
        title: t("settings.environment.saveFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onTabChange(next: string) {
    const tab = next as ProjectsSettingsTab;
    if (tab === projectsTab) return;

    (async () => {
      const leavingEnv =
        projectsTab === "environment" && envDirty && tab !== "environment";
      if (leavingEnv && !(await guardEnvDirty())) {
        return;
      }
      if (
        projectsTab === "skills" &&
        tab !== "skills" &&
        !(await leaveSkillsTransientState(t))
      ) {
        return;
      }
      if (leavingEnv) {
        setEnvDirty(false);
      }
      setProjectsTab(tab);
    })().catch(() => undefined);
  }

  if (projects.length === 0) {
    return (
      <div className="px-4 pb-4" id="projects">
        <div className="mb-4 flex min-w-0 flex-col gap-1">
          <h1 className="text-xl">{t("settings.section.projects")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("settings.projects.description")}
          </p>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlus data-icon="inline-start" />
            </EmptyMedia>
            <EmptyTitle>{t("settings.projects.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("settings.projects.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                addEnvironment().catch(() => undefined);
              }}
              type="button"
            >
              <FolderPlus data-icon="inline-start" />
              {t("settings.projects.addProject")}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (focused) {
    return (
      <div className="flex min-h-0 min-w-0 flex-col px-4 pb-6" id="projects">
        <div className="mb-4 flex items-center gap-3">
          <Button
            aria-label={t("settings.projects.back")}
            onClick={() => {
              goBackToList().catch(() => undefined);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowLeft data-icon="inline-start" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xl">
                {projectBasename(focused.projectRootPath)}
              </h1>
              {focused.projectRootPath === activeProjectRootPath ? (
                <Badge variant="secondary">
                  {t("settings.skills.currentBadge")}
                </Badge>
              ) : null}
            </div>
            <span className="truncate text-muted-foreground text-xs">
              {focused.projectRootPath}
            </span>
          </div>
        </div>

        <Tabs
          onValueChange={(value) => {
            onTabChange(value);
          }}
          value={projectsTab}
        >
          <div className="sticky top-0 isolate z-10 -mx-4 bg-background px-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <TabsList variant="line">
                <TabsTrigger value="environment">
                  {t("settings.projects.tabEnvironment")}
                </TabsTrigger>
                <TabsTrigger value="skills">
                  {t("settings.projects.tabSkills")}
                </TabsTrigger>
                <TabsTrigger value="general">
                  {t("settings.projects.tabGeneral")}
                </TabsTrigger>
              </TabsList>
              {projectsTab === "environment" && envDirty ? (
                <Button
                  onClick={() => {
                    triggerSave().catch(() => undefined);
                  }}
                  size="sm"
                  type="button"
                >
                  {t("settings.environment.save")}
                </Button>
              ) : null}
              {projectsTab === "skills" && skillsModeKind === "detail" ? (
                <SkillsAddMenu />
              ) : null}
            </div>
          </div>
          <div className="min-w-0 pt-4">
            {projectsTab === "environment" ? (
              <EnvironmentEditor
                key={focused.projectRootPath}
                onDirtyChange={setEnvDirty}
                project={focused}
                ref={editorRef}
              />
            ) : null}
            {projectsTab === "skills" ? (
              <SkillsSection
                embedded={{
                  onLeaveProject: () => {
                    goBackToList().catch(() => undefined);
                  },
                  projectRootPath: focused.projectRootPath,
                }}
              />
            ) : null}
            {projectsTab === "general" ? (
              <ProjectGeneralPanel
                onDelete={() => {
                  requestDelete().catch(() => undefined);
                }}
                projectRootPath={focused.projectRootPath}
              />
            ) : null}
          </div>
        </Tabs>
      </div>
    );
  }

  return (
    <ProjectsSectionList
      activeProjectRootPath={activeProjectRootPath}
      onAddProject={() => {
        addEnvironment().catch(() => undefined);
      }}
      onOpenProject={openProject}
      projects={projects}
      skillsProjects={skillsProjects}
    />
  );
}
