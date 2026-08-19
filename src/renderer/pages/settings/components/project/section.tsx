import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { FolderPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import type { ProjectsSettingsTab } from "@/pages/settings/data/projects-settings.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills/store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import type { EnvironmentEditorHandle } from "../environment-editor.tsx";
import { ProjectsSectionDetail } from "./section-detail.tsx";
import {
  defaultTabFor,
  isPierHomeSkillsDirty,
  isTabAllowedForProject,
  leaveAllSkillsTransientState,
  projectBasename,
} from "./section-helpers.ts";
import { ProjectsSectionList } from "./section-list.tsx";

/**
 * Unified project settings shell: shared project list, then Environment /
 * Skills / MCP / General (Rules deferred). Canvas materials are a kit
 * canvas, not a settings tab.
 */
export function ProjectsSection() {
  const t = useT();
  const projects = useLocalEnvironmentsStore((s) => s.projects);
  const hydration = useLocalEnvironmentsStore((s) => s.hydration);
  const worktreeBindings = useLocalEnvironmentsStore((s) => s.worktreeBindings);
  const addProject = useLocalEnvironmentsStore((s) => s.addProject);
  const removeProject = useLocalEnvironmentsStore((s) => s.removeProject);
  const activeProjectRootPath =
    useActiveDescriptor()?.context?.projectRootPath ?? null;

  const projectsTab = useSettingsDialogStore((s) => s.projectsTab);
  const setProjectsTab = useSettingsDialogStore((s) => s.setProjectsTab);
  const projectsFocusHome = useSettingsDialogStore((s) => s.projectsFocusHome);
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
  const selectedKindRef = useRef<"project" | "pier-home" | null>(null);

  useEffect(() => {
    if (selected) return;
    loadSkillsProjects().catch(() => undefined);
  }, [loadSkillsProjects, selected]);

  /**
   * Select a project/Home entry. Reset the active tab only when the entry
   * kind changes (Home ↔ project) so Environment/General do not stick onto
   * Home, and Home's narrower tab set is not reused on a normal project.
   * Reads projects from the store so callers that await a mutation (e.g. add)
   * see the post-write snapshot, not a stale render closure.
   */
  const focusProject = useCallback(
    (projectRootPath: string) => {
      const target = useLocalEnvironmentsStore
        .getState()
        .projects.find((p) => p.projectRootPath === projectRootPath);
      if (!target) return;
      const isPierHome = target.kind === "pier-home";
      const nextKind = isPierHome ? "pier-home" : "project";
      if (!isTabAllowedForProject(projectsTab, isPierHome)) {
        setProjectsTab(defaultTabFor(isPierHome));
      }
      selectedKindRef.current = nextKind;
      setSelected(projectRootPath);
    },
    [projectsTab, setProjectsTab]
  );

  useEffect(() => {
    if (projectsFocusHome) {
      const home = projects.find((p) => p.kind === "pier-home");
      if (home) {
        focusProject(home.projectRootPath);
        clearProjectsFocusPath();
        return;
      }
      if (hydration !== "pending") {
        clearProjectsFocusPath();
      }
      return;
    }
    if (projectsFocusPath) {
      if (projects.some((p) => p.projectRootPath === projectsFocusPath)) {
        focusProject(projectsFocusPath);
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
      focusProject(activeProjectRootPath);
      setInitializedFromActive(true);
    }
  }, [
    activeProjectRootPath,
    clearProjectsFocusPath,
    focusProject,
    hydration,
    initializedFromActive,
    projects,
    projectsFocusHome,
    projectsFocusPath,
    selected,
  ]);

  useEffect(() => {
    if (selected && !projects.some((p) => p.projectRootPath === selected)) {
      setSelected(null);
      selectedKindRef.current = null;
    }
  }, [selected, projects]);

  const focused =
    selected === null
      ? null
      : (projects.find((p) => p.projectRootPath === selected) ?? null);

  useEffect(() => {
    if (!focused) return;
    const isPierHome = focused.kind === "pier-home";
    selectedKindRef.current = isPierHome ? "pier-home" : "project";
    if (!isTabAllowedForProject(projectsTab, isPierHome)) {
      setProjectsTab(defaultTabFor(isPierHome));
    }
  }, [focused, projectsTab, setProjectsTab]);

  const guardEnvDirty = useCallback(async (): Promise<boolean> => {
    if (!(envDirty && focused)) {
      return true;
    }
    return await showAppConfirm({
      body: t("settings.environment.discardBody", {
        name: projectBasename(focused.projectRootPath),
      }),
      intent: "destructive",
      title: t("settings.environment.discardTitle"),
    });
  }, [envDirty, focused, t]);

  useEffect(() => {
    registerSectionGuard("projects", {
      canLeave: () => {
        if (envDirty) return false;
        if (isPierHomeSkillsDirty()) return false;
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
        if (envDirty && !(await guardEnvDirty())) {
          return false;
        }
        if (!(await leaveAllSkillsTransientState(t))) {
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
    if (!(await leaveAllSkillsTransientState(t))) {
      return;
    }
    setEnvDirty(false);
    setSelected(null);
    selectedKindRef.current = null;
    useProjectSkillsStore.getState().selectProject(null);
  }

  function openProject(projectRootPath: string) {
    if (selected === projectRootPath) {
      return;
    }
    const state = useProjectSkillsStore.getState();
    const needsSkillsLeave =
      isPierHomeSkillsDirty() ||
      Object.keys(state.editDraftBySkillId).length > 0 ||
      state.mode.kind === "import-review" ||
      state.planPending ||
      state.applyPending ||
      state.writesFrozen;

    const switchTo = async (clearDirty: boolean) => {
      if (needsSkillsLeave && !(await leaveAllSkillsTransientState(t))) {
        return;
      }
      if (clearDirty) {
        setEnvDirty(false);
      }
      focusProject(projectRootPath);
    };

    if (!(envDirty || needsSkillsLeave)) {
      focusProject(projectRootPath);
      return;
    }
    if (envDirty) {
      (async () => {
        if (!(await guardEnvDirty())) return;
        await switchTo(true);
      })().catch(() => undefined);
      return;
    }
    switchTo(false).catch(() => undefined);
  }

  async function addEnvironment() {
    try {
      const dir = await window.pier.environments.pickProjectDirectory();
      if (!dir) return;
      await addProject({ projectRootPath: dir });
      focusProject(dir);
    } catch (err) {
      await showAppAlert({
        title: t("settings.environment.addFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function requestDelete() {
    if (!focused) return;
    if (!(await leaveAllSkillsTransientState(t))) {
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
      title: t("settings.projects.general.deleteConfirmTitle"),
    });
    if (!ok) return;
    try {
      await removeProject({ projectRootPath: focused.projectRootPath });
      setSelected(null);
      selectedKindRef.current = null;
      setEnvDirty(false);
    } catch (err) {
      await showAppAlert({
        title: t("settings.environment.deleteFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function triggerEnvSave() {
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
    const isPierHome = focused?.kind === "pier-home";
    if (!isTabAllowedForProject(tab, Boolean(isPierHome))) {
      return;
    }

    (async () => {
      const leavingEnv =
        projectsTab === "environment" && envDirty && tab !== "environment";
      if (leavingEnv && !(await guardEnvDirty())) {
        return;
      }
      if (
        projectsTab === "skills" &&
        tab !== "skills" &&
        !(await leaveAllSkillsTransientState(t))
      ) {
        return;
      }
      if (leavingEnv) {
        setEnvDirty(false);
      }
      setProjectsTab(tab);
    })().catch(() => undefined);
  }

  if (hydration === "pending") {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-col gap-3 px-4 pb-2"
        id="projects"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-7 w-24" />
        </div>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex min-h-0 min-w-0 flex-col px-4 pb-2" id="projects">
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
      <ProjectsSectionDetail
        activeProjectRootPath={activeProjectRootPath}
        editorRef={editorRef}
        envDirty={envDirty}
        focused={focused}
        onBack={() => {
          goBackToList().catch(() => undefined);
        }}
        onDelete={() => {
          requestDelete().catch(() => undefined);
        }}
        onDirtyChange={setEnvDirty}
        onTabChange={onTabChange}
        projectsTab={projectsTab}
        skillsModeKind={skillsModeKind}
        t={t}
        triggerEnvSave={() => {
          triggerEnvSave().catch(() => undefined);
        }}
      />
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
