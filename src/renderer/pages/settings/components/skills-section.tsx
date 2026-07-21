import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { initProjectSkillsBridge } from "@/stores/project-skills-actions.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { discardReviewCandidate } from "./skills/skills-candidate-lifecycle.ts";
import { SkillsImportReview } from "./skills/skills-import-review.tsx";
import { SkillsProjectDetail } from "./skills/skills-project-detail.tsx";
import { SkillsProjectList } from "./skills/skills-project-list.tsx";
import { SkillsReadonlyDetail } from "./skills/skills-readonly-detail.tsx";
import { useSkillsSectionActions } from "./skills/skills-section-actions.ts";
import {
  confirmDiscardSkillEditDrafts,
  leaveSkillsTransientState,
} from "./skills/skills-shared.tsx";
import { SkillsSkillDetail } from "./skills/skills-skill-detail.tsx";

export { confirmSkillsLaunchBlock } from "@/lib/skills/launch-block.ts";

/**
 * Skills section router (design v9 §7.1): single main line
 * projects → project detail (unified managed + unmanaged list) → skill detail
 * / import or adoption preview.
 *
 * When `embedded` is set (projects settings shell), the shared project list is
 * owned by ProjectsSection; this section only renders the selected project's
 * skills workspace.
 */
export function SkillsSection({
  embedded,
}: {
  embedded?: {
    onLeaveProject: () => void;
    projectRootPath: string;
  };
} = {}) {
  const t = useT();
  const activeProjectRootPath =
    useActiveDescriptor()?.context?.projectRootPath ?? null;
  const registerSectionGuard = useSettingsDialogStore(
    (s) => s.registerSectionGuard
  );

  const mode = useProjectSkillsStore((s) => s.mode);
  const projects = useProjectSkillsStore((s) => s.projects);
  const projectRef = useProjectSkillsStore((s) => s.projectRef);
  const snapshot = useProjectSkillsStore((s) => s.snapshot);
  const loadStatus = useProjectSkillsStore((s) => s.loadStatus);
  const writesFrozen = useProjectSkillsStore((s) => s.writesFrozen);
  const pendingOpenProjectPath = useProjectSkillsStore(
    (s) => s.pendingOpenProjectPath
  );
  const pendingFocusIssueIds = useProjectSkillsStore(
    (s) => s.pendingFocusIssueIds
  );
  const loadProjects = useProjectSkillsStore((s) => s.loadProjects);
  const loadSnapshot = useProjectSkillsStore((s) => s.loadSnapshot);
  const selectProject = useProjectSkillsStore((s) => s.selectProject);
  const setMode = useProjectSkillsStore((s) => s.setMode);
  const setDraft = useProjectSkillsStore((s) => s.setDraft);
  const registerCandidate = useProjectSkillsStore((s) => s.registerCandidate);
  const pollOperation = useProjectSkillsStore((s) => s.pollOperation);
  const [adoptPending, setAdoptPending] = useState(false);
  const adoptRequestRef = useRef(0);
  const embeddedPath = embedded?.projectRootPath ?? null;
  const onLeaveProject = embedded?.onLeaveProject;

  useEffect(() => {
    const bridge = initProjectSkillsBridge();
    let cancelled = false;
    loadProjects(activeProjectRootPath ?? undefined)
      .then((activeRef) => {
        if (cancelled || !activeRef) return;
        const state = useProjectSkillsStore.getState();
        if (!state.projectRef) {
          state.selectProject(activeRef);
          state.loadSnapshot(activeRef).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      bridge.dispose();
    };
  }, [activeProjectRootPath, loadProjects]);

  // Embedded projects shell: pin the selected project root.
  useEffect(() => {
    if (!embeddedPath) return;
    let cancelled = false;
    async function pinEmbedded() {
      const state = useProjectSkillsStore.getState();
      if (state.projectRef?.realPath === embeddedPath) {
        if (state.mode.kind === "projects") {
          state.setMode({ kind: "detail" });
        }
        return;
      }
      const match = state.projects.find(
        (p) => p.projectRef.realPath === embeddedPath
      );
      if (match) {
        if (!(await confirmDiscardSkillEditDrafts(t)) || cancelled) return;
        state.selectProject(match.projectRef);
        await state.loadSnapshot(match.projectRef);
        return;
      }
      const resolved = await state.loadProjects(embeddedPath ?? undefined);
      if (cancelled || !resolved) return;
      if (!(await confirmDiscardSkillEditDrafts(t)) || cancelled) return;
      useProjectSkillsStore.getState().selectProject(resolved);
      await useProjectSkillsStore.getState().loadSnapshot(resolved);
    }
    pinEmbedded().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [embeddedPath, t]);

  const previousModeKindRef = useRef(mode.kind);
  const detailScrollTopRef = useRef(0);
  let modeIdentity: string = mode.kind;
  if (mode.kind === "detail") {
    modeIdentity = `${mode.kind}:${projectRef?.realPath ?? ""}`;
  } else if (mode.kind === "skill-detail") {
    modeIdentity = `${mode.kind}:${JSON.stringify(mode.target)}`;
  } else if (mode.kind === "import-review") {
    modeIdentity = `${mode.kind}:${mode.candidate.token}`;
  }

  useEffect(() => {
    if (modeIdentity.length === 0) return;
    return () => {
      adoptRequestRef.current += 1;
    };
  }, [modeIdentity]);

  // Internal settings pages share one scroll container. Forward navigation
  // starts at the heading; Back restores the project's prior list position.
  useEffect(() => {
    if (!modeIdentity) return;
    const section = document.getElementById("skills");
    const scrollContainer = section?.closest("main");
    if (!scrollContainer) return;
    const previousKind = previousModeKindRef.current;
    if (mode.kind === "detail" && previousKind !== "projects") {
      scrollContainer.scrollTop = detailScrollTopRef.current;
    } else {
      if (previousKind === "detail" && mode.kind !== "detail") {
        detailScrollTopRef.current = scrollContainer.scrollTop;
      }
      scrollContainer.scrollTop = 0;
    }
    previousModeKindRef.current = mode.kind;
    section
      ?.querySelector<HTMLElement>("h1[tabindex], h2[tabindex]")
      ?.focus({ preventScroll: true });
  }, [mode.kind, modeIdentity]);

  const focusSkillId = snapshot?.health.issues.find(
    (item) =>
      pendingFocusIssueIds.includes(item.id) && item.skillId !== undefined
  )?.skillId;

  // Deep link (design v9 §7.1 / §7.8): land on the requested project's
  // detail (launch-block "open skill settings"). Confirm before wiping
  // unsaved editor drafts when switching projects (§7.7). Same-project
  // deep links keep drafts and only clear the pending path.
  const openProjectRetriedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingOpenProjectPath) {
      return;
    }
    let cancelled = false;
    const requestedPath = pendingOpenProjectPath;
    const match = projects.find((p) => p.projectRef.realPath === requestedPath);

    async function openPending(): Promise<void> {
      if (match) {
        const current = useProjectSkillsStore.getState().projectRef;
        if (current?.realPath === match.projectRef.realPath) {
          openProjectRetriedPathRef.current = null;
          useProjectSkillsStore.setState({ pendingOpenProjectPath: null });
          return;
        }
        if (!(await confirmDiscardSkillEditDrafts(t)) || cancelled) {
          if (!cancelled) {
            useProjectSkillsStore.setState({ pendingOpenProjectPath: null });
          }
          return;
        }
        if (cancelled) return;
        openProjectRetriedPathRef.current = null;
        useProjectSkillsStore.setState({ pendingOpenProjectPath: null });
        selectProject(match.projectRef, true);
        loadSnapshot(match.projectRef).catch(() => undefined);
        return;
      }
      if (loadStatus === "loading") {
        return;
      }
      if (openProjectRetriedPathRef.current === requestedPath) {
        openProjectRetriedPathRef.current = null;
        useProjectSkillsStore.setState({
          pendingFocusIssueIds: [],
          pendingOpenProjectPath: null,
        });
        toast.error(t("settings.skills.openProjectMissing"));
        return;
      }
      openProjectRetriedPathRef.current = requestedPath;
      const resolvedRef = await loadProjects(requestedPath);
      if (cancelled) return;
      const state = useProjectSkillsStore.getState();
      if (!resolvedRef || state.pendingOpenProjectPath !== requestedPath) {
        return;
      }
      if (state.projectRef?.realPath === resolvedRef.realPath) {
        openProjectRetriedPathRef.current = null;
        useProjectSkillsStore.setState({ pendingOpenProjectPath: null });
        return;
      }
      if (!(await confirmDiscardSkillEditDrafts(t)) || cancelled) {
        if (!cancelled) {
          useProjectSkillsStore.setState({ pendingOpenProjectPath: null });
        }
        return;
      }
      if (cancelled) return;
      openProjectRetriedPathRef.current = null;
      useProjectSkillsStore.setState({ pendingOpenProjectPath: null });
      state.selectProject(resolvedRef, true);
      state.loadSnapshot(resolvedRef).catch(() => undefined);
    }

    openPending().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    pendingOpenProjectPath,
    projects,
    loadStatus,
    selectProject,
    loadSnapshot,
    loadProjects,
    t,
  ]);

  useEffect(() => {
    if (
      mode.kind !== "detail" ||
      !snapshot ||
      pendingFocusIssueIds.length === 0
    ) {
      return;
    }
    if (!focusSkillId) {
      useProjectSkillsStore.setState({ pendingFocusIssueIds: [] });
      return;
    }
    let frame = 0;
    let frameId = 0;
    const focusTarget = () => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>("[data-skill-id]")
      ).find((element) => element.dataset.skillId === focusSkillId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
        useProjectSkillsStore.setState({ pendingFocusIssueIds: [] });
        return;
      }
      frame += 1;
      if (frame < 5) {
        frameId = window.requestAnimationFrame(focusTarget);
      }
    };
    frameId = window.requestAnimationFrame(focusTarget);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [focusSkillId, mode.kind, pendingFocusIssueIds, snapshot]);

  // Poll the pending operation while writes are frozen (indeterminate apply).
  useEffect(() => {
    if (!writesFrozen) {
      return;
    }
    const timer = window.setInterval(() => {
      pollOperation().catch(() => undefined);
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [writesFrozen, pollOperation]);

  // Unsaved skill-editor text, import review, and in-flight writes all block
  // leaving until confirmed or finished (design v9 §7.7).
  // Embedded under ProjectsSection: the projects shell owns the leave guard.
  useEffect(() => {
    if (embeddedPath) {
      return;
    }
    registerSectionGuard("skills", {
      canLeave: () => {
        const state = useProjectSkillsStore.getState();
        return (
          Object.keys(state.editDraftBySkillId).length === 0 &&
          state.mode.kind !== "import-review" &&
          !state.planPending &&
          !state.applyPending &&
          !state.writesFrozen
        );
      },
      leave: async () => await leaveSkillsTransientState(t),
    });
    return () => {
      registerSectionGuard("skills", null);
    };
  }, [embeddedPath, registerSectionGuard, t]);

  const {
    openProject,
    reviewCandidate,
    cancelReview,
    commitCandidate,
    adoptUnmanaged,
    resolveReadonlyTarget,
  } = useSkillsSectionActions({
    adoptPending,
    adoptRequestRef,
    loadProjects,
    loadSnapshot,
    projects,
    registerCandidate,
    selectProject,
    setAdoptPending,
    setDraft,
    setMode,
    snapshot,
  });

  function renderContent() {
    if (mode.kind === "projects" || !projectRef) {
      if (embeddedPath) {
        return null;
      }
      return (
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-xl" tabIndex={-1}>
              {t("settings.section.skills")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("settings.skills.description")}
            </p>
          </div>
          <SkillsProjectList
            activeProjectRootPath={activeProjectRootPath}
            loadFailed={loadStatus === "error"}
            loading={loadStatus === "loading"}
            onOpenProject={(project) => {
              openProject(project.projectRef).catch(() => undefined);
            }}
            onProjectsChanged={() => loadProjects()}
            projects={projects}
          />
        </div>
      );
    }
    if (mode.kind === "skill-detail") {
      const target = mode.target;
      if (target.kind === "managed") {
        return (
          <SkillsSkillDetail
            onBack={() => {
              setMode({ kind: "detail" });
            }}
            skillId={target.skillId}
          />
        );
      }
      // Read-only detail for project-directory / user-global entries.
      const readonlyTarget = resolveReadonlyTarget(target);
      if (!readonlyTarget) {
        setMode({ kind: "detail" });
        return null;
      }
      return (
        <SkillsReadonlyDetail
          adoptPending={adoptPending}
          onAdopt={(entry) => {
            adoptUnmanaged(entry).catch(() => undefined);
          }}
          onBack={() => {
            setMode({ kind: "detail" });
          }}
          target={readonlyTarget}
        />
      );
    }
    if (mode.kind === "import-review") {
      const candidate = mode.candidate;
      // Import/adoption never overwrites or renames an existing library id.
      const conflict =
        snapshot?.skills.some((s) => s.id === candidate.skillId) ?? false;
      return (
        <SkillsImportReview
          candidate={candidate}
          conflict={conflict}
          onCancel={() => {
            cancelReview(candidate).catch(() => undefined);
          }}
          onConfirm={() => {
            commitCandidate(candidate).catch(() => undefined);
          }}
          onConflictResolve={() => {
            discardReviewCandidate(candidate)
              .then(async () => {
                const state = useProjectSkillsStore.getState();
                state.setMode({ kind: "detail" });
                if (state.projectRef) {
                  await state.loadSnapshot(state.projectRef);
                }
              })
              .catch(() => undefined);
          }}
        />
      );
    }
    return (
      <SkillsProjectDetail
        activeProjectRootPath={activeProjectRootPath}
        {...(focusSkillId === undefined ? {} : { focusSkillId })}
        hideBack={Boolean(embeddedPath)}
        onBack={() => {
          confirmDiscardSkillEditDrafts(t)
            .then((ok) => {
              if (!ok) return;
              if (onLeaveProject) {
                onLeaveProject();
                return;
              }
              selectProject(null);
            })
            .catch(() => undefined);
        }}
        onOpenSkill={(target) => {
          setMode({ kind: "skill-detail", target });
        }}
        onReviewCandidate={reviewCandidate}
      />
    );
  }

  return (
    <div className={embeddedPath ? "min-w-0" : "min-w-0 px-4 pb-4"} id="skills">
      {renderContent()}
    </div>
  );
}
