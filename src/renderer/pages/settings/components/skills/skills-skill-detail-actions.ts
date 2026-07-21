import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  emptyDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { commitSkillsIntent } from "./skills-apply-flow.ts";
import { discardPreparedCandidate } from "./skills-candidate-lifecycle.ts";
import { skillsErrorMessage } from "./skills-error-copy.ts";

function isImportCandidate(value: unknown): value is { token: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { token?: unknown }).token === "string";
}

export function useSkillsSkillDetailActions(args: {
  editorText: string;
  isSystem: boolean;
  libraryPath: string;
  onBack: () => void;
  preparePending: boolean;
  prepareRequestRef: { current: number };
  projectRef: ProjectRootRef | null;
  setContent: (content: { skillMd: string; truncated: boolean }) => void;
  setEditDraft: (skillId: string, text: string | null) => void;
  setPreparePending: (pending: boolean) => void;
  setRetryNonce: Dispatch<SetStateAction<number>>;
  skill: { id: string; contentDigest: string } | null;
  skillId: string;
  snapshot: {
    manifest?: { delivery?: { agents?: boolean; claude?: boolean } } | null;
  } | null;
  writesDisabled: boolean;
}) {
  const t = useT();
  const {
    editorText,
    isSystem,
    libraryPath,
    onBack,
    preparePending,
    prepareRequestRef,
    projectRef,
    setContent,
    setEditDraft,
    setPreparePending,
    setRetryNonce,
    skill,
    skillId,
    snapshot,
    writesDisabled,
  } = args;

  async function copyLibraryPath() {
    try {
      await navigator.clipboard.writeText(libraryPath);
      toast.success(t("settings.skills.copySuccess"));
    } catch {
      toast.error(t("settings.skills.copyFailed"));
    }
  }

  async function deleteSkill() {
    const intent = emptyDraft({
      agents: Boolean(snapshot?.manifest?.delivery?.agents),
      claude: Boolean(snapshot?.manifest?.delivery?.claude),
    });
    intent.deleteSkillIds = [skillId];
    const result = await commitSkillsIntent({
      draft: intent,
      t,
    });
    if (result === "converged" || result === "degraded") {
      onBack();
    }
  }

  async function toggleEnabled(enabled: boolean) {
    if (writesDisabled || isSystem) return;
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

  async function saveEdit() {
    if (!(projectRef && skill) || preparePending || writesDisabled) return;
    const requestId = prepareRequestRef.current + 1;
    prepareRequestRef.current = requestId;
    const requestProject = projectRef;
    setPreparePending(true);
    try {
      const candidate =
        await window.pier.projectSkills.importPrepareContentUpdate(
          requestProject,
          {
            skillId: skill.id,
            baseContentDigest: skill.contentDigest,
            skillMd: editorText,
          }
        );
      const latestMode = useProjectSkillsStore.getState().mode;
      if (
        prepareRequestRef.current !== requestId ||
        useProjectSkillsStore.getState().projectRef?.realPath !==
          requestProject.realPath ||
        latestMode.kind !== "skill-detail" ||
        latestMode.target.kind !== "managed" ||
        latestMode.target.skillId !== skillId
      ) {
        await discardPreparedCandidate(requestProject, candidate);
        return;
      }
      if (!isImportCandidate(candidate)) {
        await showAppAlert({
          title: t("settings.skills.editFailed"),
          body: t("settings.skills.importInvalid"),
        });
        return;
      }
      const intent = emptyDraft({
        agents: Boolean(snapshot?.manifest?.delivery?.agents),
        claude: Boolean(snapshot?.manifest?.delivery?.claude),
      });
      intent.importTokens = [candidate.token];
      const result = await commitSkillsIntent({
        draft: intent,
        t,
      });
      if (result === "converged") {
        setEditDraft(skill.id, null);
        setContent({ skillMd: editorText, truncated: false });
      } else if (result === "degraded") {
        setEditDraft(skill.id, null);
        setContent({ skillMd: editorText, truncated: false });
      } else if (result === "failed" || result === "cancelled") {
        await discardPreparedCandidate(requestProject, candidate);
      }
    } catch (error) {
      if (prepareRequestRef.current === requestId) {
        await showAppAlert({
          title: t("settings.skills.editFailed"),
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

  async function adoptCurrentFiles() {
    if (!(projectRef && skill) || preparePending) return;
    const requestId = prepareRequestRef.current + 1;
    prepareRequestRef.current = requestId;
    const requestProject = projectRef;
    setPreparePending(true);
    try {
      const candidate =
        await window.pier.projectSkills.importPrepareDriftAcceptance(
          requestProject,
          { skillId: skill.id }
        );
      const latestMode = useProjectSkillsStore.getState().mode;
      if (
        prepareRequestRef.current !== requestId ||
        useProjectSkillsStore.getState().projectRef?.realPath !==
          requestProject.realPath ||
        latestMode.kind !== "skill-detail" ||
        latestMode.target.kind !== "managed" ||
        latestMode.target.skillId !== skillId
      ) {
        await discardPreparedCandidate(requestProject, candidate);
        return;
      }
      if (!isImportCandidate(candidate)) {
        await showAppAlert({
          title: t("settings.skills.importFailed"),
          body: t("settings.skills.importInvalid"),
        });
        return;
      }
      const intent = emptyDraft({
        agents: Boolean(snapshot?.manifest?.delivery?.agents),
        claude: Boolean(snapshot?.manifest?.delivery?.claude),
      });
      intent.importTokens = [candidate.token];
      const result = await commitSkillsIntent({
        draft: intent,
        t,
      });
      if (result === "failed" || result === "cancelled") {
        await discardPreparedCandidate(requestProject, candidate);
      } else if (result === "converged" || result === "degraded") {
        setEditDraft(skill.id, null);
        setRetryNonce((value) => value + 1);
      }
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

  return {
    adoptCurrentFiles,
    copyLibraryPath,
    deleteSkill,
    saveEdit,
    toggleEnabled,
  };
}
