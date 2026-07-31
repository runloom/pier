import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import { resolveSkillDelivery } from "@shared/contracts/project-skills.ts";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  type ApplyOutcome,
  emptyDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { commitSkillsIntent } from "./apply-flow.ts";
import { discardPreparedCandidate } from "./candidate-lifecycle.ts";
import { skillsErrorMessage } from "./error-copy.ts";

function isImportCandidate(value: unknown): value is { token: string } {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { token?: unknown }).token === "string";
}

export interface SkillDiscoveryDraft {
  enabled: boolean;
  skillDelivery: { agents: boolean; claude: boolean };
}

export function useSkillsSkillDetailActions(args: {
  discoveryDraft: SkillDiscoveryDraft | null;
  discoveryDirty: boolean;
  editorText: string;
  hasEditDraft: boolean;
  isSystem: boolean;
  libraryPath: string;
  onBack: () => void;
  preparePending: boolean;
  prepareRequestRef: { current: number };
  projectRef: ProjectRootRef | null;
  setContent: (content: { skillMd: string; truncated: boolean }) => void;
  setDiscoveryDraft: (next: SkillDiscoveryDraft | null) => void;
  setEditDraft: (skillId: string, text: string | null) => void;
  setPreparePending: (pending: boolean) => void;
  setRetryNonce: Dispatch<SetStateAction<number>>;
  skill: {
    id: string;
    contentDigest: string;
    enabled: boolean;
    delivery: { agents: boolean; claude: boolean } | null;
  } | null;
  skillId: string;
  snapshot: {
    manifest?: { delivery?: { agents?: boolean; claude?: boolean } } | null;
  } | null;
  writesDisabled: boolean;
}) {
  const t = useT();
  const {
    discoveryDraft,
    discoveryDirty,
    editorText,
    hasEditDraft,
    libraryPath,
    onBack,
    preparePending,
    prepareRequestRef,
    projectRef,
    setContent,
    setDiscoveryDraft,
    setEditDraft,
    setPreparePending,
    setRetryNonce,
    skill,
    skillId,
    snapshot,
    writesDisabled,
  } = args;

  function deliveryBaseline() {
    return {
      agents: Boolean(snapshot?.manifest?.delivery?.agents),
      claude: Boolean(snapshot?.manifest?.delivery?.claude),
    };
  }

  async function copyLibraryPath() {
    try {
      await navigator.clipboard.writeText(libraryPath);
      toast.success(t("settings.skills.copySuccess"));
    } catch {
      toast.error(t("settings.skills.copyFailed"));
    }
  }

  async function deleteSkill() {
    const intent = emptyDraft(deliveryBaseline());
    intent.deleteSkillIds = [skillId];
    const result = await commitSkillsIntent({
      draft: intent,
      t,
    });
    if (result === "converged" || result === "degraded") {
      onBack();
    }
  }

  async function saveEdit(): Promise<ApplyOutcome | "noop"> {
    if (!(projectRef && skill) || preparePending || writesDisabled) {
      return "noop";
    }
    const contentDirty = hasEditDraft;
    if (!(contentDirty || discoveryDirty)) {
      return "noop";
    }
    if (contentDirty && editorText.trim().length === 0) {
      return "noop";
    }

    const requestId = prepareRequestRef.current + 1;
    prepareRequestRef.current = requestId;
    const requestProject = projectRef;
    setPreparePending(true);
    let preparedToken: string | null = null;
    try {
      if (contentDirty) {
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
          return "cancelled";
        }
        if (!isImportCandidate(candidate)) {
          await showAppAlert({
            title: t("settings.skills.editFailed"),
            body: t("settings.skills.importInvalid"),
          });
          return "failed";
        }
        preparedToken = candidate.token;
      }

      const projectDelivery = deliveryBaseline();
      const intent = emptyDraft(projectDelivery);
      if (preparedToken) {
        intent.importTokens = [preparedToken];
      }
      if (discoveryDirty && discoveryDraft) {
        intent.enabledBySkillId[skillId] = discoveryDraft.enabled;
        intent.deliveryBySkillId[skillId] = discoveryDraft.skillDelivery;
        if (discoveryDraft.skillDelivery.agents) {
          intent.deliveryAgents = true;
        }
        if (discoveryDraft.skillDelivery.claude) {
          intent.deliveryClaude = true;
        }
      }
      const result = await commitSkillsIntent({
        draft: intent,
        t,
      });
      if (result === "converged" || result === "degraded") {
        if (contentDirty) {
          setEditDraft(skill.id, null);
          setContent({ skillMd: editorText, truncated: false });
        }
        setDiscoveryDraft(null);
      } else if (
        (result === "failed" || result === "cancelled") &&
        preparedToken
      ) {
        await discardPreparedCandidate(requestProject, {
          token: preparedToken,
        });
      }
      return result;
    } catch (error) {
      if (prepareRequestRef.current === requestId) {
        if (preparedToken) {
          await discardPreparedCandidate(requestProject, {
            token: preparedToken,
          });
        }
        await showAppAlert({
          title: t("settings.skills.editFailed"),
          body: skillsErrorMessage(
            error,
            t,
            "settings.skills.importFailedBody"
          ),
        });
      }
      return "failed";
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
      const intent = emptyDraft(deliveryBaseline());
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
  };
}

/** Live baseline used to seed / compare the discovery draft. */
export function liveDiscoveryDraft(args: {
  enabled: boolean;
  projectDelivery: { agents: boolean; claude: boolean };
  skillDelivery: { agents: boolean; claude: boolean } | null;
}): SkillDiscoveryDraft {
  const channels = resolveSkillDelivery({
    enabled: args.enabled,
    projectDelivery: args.projectDelivery,
    skillDelivery: args.skillDelivery,
  });
  return {
    enabled: args.enabled && (channels.agents || channels.claude),
    skillDelivery: channels,
  };
}
