import { Badge } from "@pier/ui/badge.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  ProjectSkillView,
  SkillEffectiveCell,
} from "@shared/contracts/project-skills.ts";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { discardActiveImportReview } from "./skills-candidate-lifecycle.ts";

export type Translate = TFunction;

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
    size: "sm",
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

function isAttention(cell: SkillEffectiveCell): boolean {
  return (
    cell.effect.state === "shadowed-by-user" ||
    cell.effect.state === "overridden" ||
    cell.effect.state === "duplicate" ||
    cell.effect.state === "unknown-version"
  );
}

function agentLabel(cell: SkillEffectiveCell): string {
  return (
    getAgentCatalogEntry(cell.agentKind as AgentKind)?.label ?? cell.agentKind
  );
}

/**
 * Row-level effect summary (design v8 §7.3): colored icons + a readable
 * count for agents that can discover the skill, one warning badge per
 * precedence-attention agent, and a muted "not effective" line when neither
 * applies. The complete per-agent facts live in the detail page matrix.
 */
export function AgentEffectSummary({
  effects,
  t,
}: {
  effects: readonly SkillEffectiveCell[];
  t: Translate;
}) {
  const cells = effects.filter(
    (cell) =>
      cell.effect.state !== "agent-not-installed" &&
      cell.effect.state !== "not-applicable"
  );
  const discoverable = cells.filter(
    (cell) => cell.effect.state === "discoverable"
  );
  const attention = cells.filter(isAttention);
  const attentionGroups = [
    ...attention
      .reduce((groups, cell) => {
        const viaRoot =
          "viaRoot" in cell.effect ? (cell.effect.viaRoot ?? "") : "";
        const key = `${cell.effect.state}\0${viaRoot}`;
        const group = groups.get(key) ?? [];
        group.push(cell);
        groups.set(key, group);
        return groups;
      }, new Map<string, SkillEffectiveCell[]>())
      .values(),
  ];
  if (discoverable.length === 0 && attention.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {t("settings.skills.effectSummaryNone")}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {discoverable.length > 0 ? (
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
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
          <span className="text-muted-foreground text-xs">
            {t("settings.skills.effectSummaryDiscoverable", {
              count: discoverable.length,
            })}
          </span>
        </span>
      ) : null}
      {attentionGroups.map((group) => {
        const sample = group[0];
        if (!sample) return null;
        return (
          <Badge
            key={`${sample.effect.state}:${group.map(agentLabel).join(",")}`}
            variant="warning"
          >
            <span className="inline-flex items-center gap-0.5">
              {group.map((cell) => (
                <span
                  aria-label={agentLabel(cell)}
                  className="inline-flex items-center"
                  key={cell.agentKind}
                  role="img"
                >
                  <AgentIcon agentId={cell.agentKind as AgentKind} size={14} />
                </span>
              ))}
            </span>
            {group.length === 1
              ? effectLabel(sample, t)
              : t("settings.skills.matrixGroupState", {
                  count: group.length,
                  state: effectLabel(sample, t),
                })}
          </Badge>
        );
      })}
    </div>
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
    case "library-drift":
      return t("settings.skills.issueLibraryDrift", {
        skill: issue.skillId ?? "",
      });
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
    code === "library-drift" ||
    code === "missing-source" ||
    code === "invalid-skill" ||
    code === "ledger-corrupt" ||
    code === "recovery-record-corrupt" ||
    code === "recovery-blocked"
  );
}
