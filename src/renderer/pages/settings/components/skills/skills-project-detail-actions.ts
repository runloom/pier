import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  emptyDraft,
  type ImportCandidateView,
  type SkillsUiDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { commitSkillsIntent, runRepair } from "./skills-apply-flow.ts";
import { discardPreparedCandidate } from "./skills-candidate-lifecycle.ts";
import { skillsErrorMessage } from "./skills-error-copy.ts";

function isImportCandidate(value: unknown): value is ImportCandidateView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.token === "string" && typeof record.skillId === "string";
}

export function useSkillsProjectDetailActions(args: {
  onReviewCandidate: (candidate: ImportCandidateView) => void;
  preparePending: boolean;
  prepareRequestRef: { current: number };
  projectRef: ProjectRootRef | null;
  retryDraft: SkillsUiDraft | null;
  setPreparePending: (pending: boolean) => void;
  snapshot: {
    manifest?: { delivery?: { agents?: boolean; claude?: boolean } } | null;
  } | null;
  writesDisabled: boolean;
}) {
  const t = useT();
  const loadSnapshot = useProjectSkillsStore((s) => s.loadSnapshot);
  const setDraft = useProjectSkillsStore((s) => s.setDraft);
  const {
    onReviewCandidate,
    preparePending,
    prepareRequestRef,
    projectRef,
    retryDraft,
    setPreparePending,
    snapshot,
    writesDisabled,
  } = args;

  function reviewCandidate(raw: unknown): void {
    if (!isImportCandidate(raw)) {
      showAppAlert({
        title: t("settings.skills.importFailed"),
        body: t("settings.skills.importInvalid"),
      }).catch(() => undefined);
      return;
    }
    onReviewCandidate(raw);
  }

  async function handleImportFolder() {
    if (!projectRef || preparePending) return;
    const requestId = prepareRequestRef.current + 1;
    prepareRequestRef.current = requestId;
    const requestProject = projectRef;
    setPreparePending(true);
    try {
      const candidate =
        await window.pier.projectSkills.importPrepare(requestProject);
      if (!candidate) return;
      if (
        prepareRequestRef.current !== requestId ||
        useProjectSkillsStore.getState().projectRef?.realPath !==
          requestProject.realPath ||
        useProjectSkillsStore.getState().mode.kind !== "detail"
      ) {
        await discardPreparedCandidate(requestProject, candidate);
        return;
      }
      reviewCandidate(candidate);
    } catch (error) {
      if (prepareRequestRef.current === requestId) {
        await showAppAlert({
          title: t("settings.skills.importFailed"),
          body: skillsErrorMessage(
            error,
            t,
            "settings.skills.importFailedBody"
          ),
        });
      }
    } finally {
      if (prepareRequestRef.current === requestId) {
        setPreparePending(false);
      }
    }
  }

  async function handleToggle(skillId: string, enabled: boolean) {
    if (writesDisabled) return;
    const intent = emptyDraft({
      agents: Boolean(snapshot?.manifest?.delivery?.agents),
      claude: Boolean(snapshot?.manifest?.delivery?.claude),
    });
    intent.enabledBySkillId[skillId] = enabled;
    await commitSkillsIntent({
      draft: intent,
      t,
    });
  }

  async function handleReload() {
    if (!projectRef) return;
    await loadSnapshot(projectRef);
    setDraft(null);
  }

  async function handleRetryOperation() {
    if (!retryDraft) return;
    await commitSkillsIntent({ draft: retryDraft, t });
  }

  return {
    handleImportFolder,
    handleReload,
    handleRetryOperation,
    handleToggle,
    reviewCandidate,
    runRepair: () => runRepair(t),
  };
}
