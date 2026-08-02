import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  ProjectSkillView,
  SkillEffectiveCell,
} from "@shared/contracts/project-skills.ts";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { discardActiveImportReview } from "./candidate-lifecycle.ts";

export type Translate = TFunction;

/** Clarifies that the skill open UI only shows SKILL.md, not the whole folder. */
export function SkillMdScopeNotice({ t }: { t: Translate }) {
  return (
    <p className="text-muted-foreground text-xs">
      {t("settings.skills.contentSkillMdOnlyNotice")}
    </p>
  );
}

/**
 * §7.7: confirm before discarding unsaved skill-editor drafts. Returns true
 * when there is nothing to discard or the user confirms.
 */
export async function confirmDiscardSkillEditDrafts(
  t: Translate
): Promise<boolean> {
  const state = useProjectSkillsStore.getState();
  const dirtySkillIds = Object.keys(state.editDraftBySkillId);
  if (dirtySkillIds.length === 0) {
    return true;
  }
  const ok = await showAppConfirm({
    body: t("settings.skills.leaveEditBody"),
    intent: "destructive",
    title: t("settings.skills.leaveEditTitle"),
  });
  if (!ok) {
    return false;
  }
  for (const skillId of dirtySkillIds) {
    state.setEditDraft(skillId, null);
  }
  return true;
}

/**
 * Shared leave path for Projects shell (back / tab / section leave) and
 * standalone skills: drafts confirm + import-review discard (§7.7).
 * Returns false when the user cancels or writes are still in flight.
 */
export async function leaveSkillsTransientState(
  t: Translate
): Promise<boolean> {
  const state = useProjectSkillsStore.getState();
  if (state.planPending || state.applyPending || state.writesFrozen) {
    toast.error(t("settings.skills.leaveBlocked"));
    return false;
  }
  if (!(await confirmDiscardSkillEditDrafts(t))) {
    return false;
  }
  await discardActiveImportReview();
  return true;
}

const PATH_SEPARATOR_RE = /[\\/]/;

export function projectBasename(path: string): string {
  return path.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ?? path;
}

export function formatBytes(totalBytes: number): string {
  if (totalBytes < 1024) return `${totalBytes} B`;
  if (totalBytes < 1024 * 1024) return `${(totalBytes / 1024).toFixed(1)} KB`;
  return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sourceLabel(
  skill: Partial<Pick<ProjectSkillView, "source">>,
  t: Translate
): string {
  switch (skill.source?.type) {
    case "project-discovery-import":
      return t("settings.skills.managedSource.projectDiscoveryImport");
    case "git-declared":
      return t("settings.skills.managedSource.gitDeclared");
    case "pier-home":
      return t("settings.skills.managedSource.pierHome");
    default:
      return t("settings.skills.managedSource.localImport");
  }
}

export function effectLabel(cell: SkillEffectiveCell, t: Translate): string {
  switch (cell.effect.state) {
    case "discoverable":
      return t("settings.skills.effectDiscoverable");
    case "not-projected":
      return t("settings.skills.effectNotProjected");
    case "shadowed-by-user":
      return t("settings.skills.effectShadowed");
    case "overridden":
      return t("settings.skills.effectOverridden");
    case "duplicate":
      return t("settings.skills.effectDuplicate");
    case "root-not-scanned":
      return t("settings.skills.effectRootNotScanned");
    case "agent-not-installed":
      return t("settings.skills.effectNotInstalled");
    case "unknown-version":
      return t("settings.skills.effectUnknownVersion");
    default:
      return t("settings.skills.effectNotProjected");
  }
}

function agentLabel(cell: SkillEffectiveCell): string {
  return (
    getAgentCatalogEntry(cell.agentKind as AgentKind)?.label ?? cell.agentKind
  );
}

/**
 * Compact list-row availability strip: unique discoverable agent icons only.
 * Path / count labels belong nowhere on this strip.
 */
export function AgentEffectSummary({
  effects,
  t,
}: {
  effects: readonly SkillEffectiveCell[];
  t: Translate;
}) {
  const discoverable = [
    ...new Map(
      effects
        .filter((cell) => cell.effect.state === "discoverable")
        .map((cell) => [cell.agentKind, cell] as const)
    ).values(),
  ].toSorted((a, b) => a.agentKind.localeCompare(b.agentKind));
  if (discoverable.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {t("settings.skills.effectSummaryNone")}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {discoverable.map((cell) => (
        <span
          aria-label={agentLabel(cell)}
          className="inline-flex size-5 items-center justify-center"
          key={cell.agentKind}
          role="img"
        >
          <AgentIcon agentId={cell.agentKind as AgentKind} size={14} />
        </span>
      ))}
    </span>
  );
}

/**
 * User-readable line for a plan blocking issue (user-copy discipline: raw
 * health codes never reach the primary path).
 */
export function issueLabel(
  issue: {
    code: string;
    skillId?: string;
    relativeTarget?: string;
    adapterKind?: string;
  },
  t: Translate
): string {
  switch (issue.code) {
    case "unmanaged-conflict":
      return t("settings.skills.issueUnmanagedConflict", {
        target: issue.relativeTarget ?? issue.skillId ?? "",
      });
    case "duplicate-discovery":
      return t("settings.skills.issueDuplicateDiscovery", {
        agent:
          getAgentCatalogEntry(issue.adapterKind as AgentKind)?.label ??
          issue.adapterKind ??
          "",
      });
    case "project-identity-changed":
      return t("settings.skills.issueIdentityChanged");
    case "missing-source":
      return t("settings.skills.issueMissingSource", {
        skill: issue.skillId ?? "",
      });
    case "invalid-skill":
      return t("settings.skills.issueInvalidManifest");
    case "ledger-corrupt":
      return t("settings.skills.issueLedgerCorrupt");
    case "recovery-record-corrupt":
    case "recovery-blocked":
      return t("settings.skills.issueRecoveryBlocked");
    default:
      return t("settings.skills.issueGeneric");
  }
}

/** Issues that actually keep apply disabled (mirrors plan.applicable). */
export function isPlanHardBlockIssue(code: string): boolean {
  return (
    code === "project-identity-changed" ||
    code === "unmanaged-conflict" ||
    code === "missing-source" ||
    code === "invalid-skill" ||
    code === "ledger-corrupt" ||
    code === "recovery-record-corrupt" ||
    code === "recovery-blocked"
  );
}
