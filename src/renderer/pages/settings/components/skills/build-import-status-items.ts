import type { StatusStackItem } from "@pier/ui/status-stack.tsx";
import type { Translate } from "./shared.tsx";

export interface SkillsImportRiskSummary {
  dynamicCommandTraces: string[];
  executables: string[];
  riskFrontmatter: Record<string, unknown>;
}

export function buildSkillsImportStatusItems(input: {
  actionBlocked: boolean;
  conflict: boolean;
  expired: boolean;
  onConflictResolve?: (() => void) | undefined;
  reloadRequired: boolean;
  riskSummary?: SkillsImportRiskSummary | null | undefined;
  skillId: string;
  t: Translate;
}): StatusStackItem[] {
  const {
    actionBlocked,
    conflict,
    expired,
    onConflictResolve,
    reloadRequired,
    riskSummary,
    skillId,
    t,
  } = input;

  const items: StatusStackItem[] = [];
  const riskFrontmatterKeys = Object.keys(riskSummary?.riskFrontmatter ?? {});
  const hasRisk =
    (riskSummary?.executables.length ?? 0) > 0 ||
    (riskSummary?.dynamicCommandTraces.length ?? 0) > 0 ||
    riskFrontmatterKeys.length > 0;

  if (hasRisk && riskSummary) {
    const lines: string[] = [];
    if (riskSummary.executables.length > 0) {
      lines.push(
        t("settings.skills.riskExecutables", {
          count: riskSummary.executables.length,
        })
      );
    }
    if (riskSummary.dynamicCommandTraces.length > 0) {
      lines.push(
        t("settings.skills.riskDynamic", {
          count: riskSummary.dynamicCommandTraces.length,
        })
      );
    }
    if (riskFrontmatterKeys.length > 0) {
      lines.push(
        t("settings.skills.riskFrontmatter", {
          keys: riskFrontmatterKeys.join(", "),
        })
      );
    }
    lines.push(t("settings.skills.riskDisclaimer"));
    items.push({
      id: "skills-import-risk",
      tone: "warning",
      title: t("settings.skills.riskTitle"),
      description: lines.join("\n"),
    });
  }

  // conflict and reload are mutually exclusive (conflict wins).
  if (conflict) {
    items.push({
      id: "skills-import-conflict",
      tone: "destructive",
      title: t("settings.skills.conflictExists", { id: skillId }),
      description: t("settings.skills.conflictExistsBody"),
      ...(onConflictResolve
        ? {
            action: {
              label: t("settings.skills.reloadAndReturn"),
              onClick: onConflictResolve,
            },
          }
        : {}),
    });
  } else if (reloadRequired) {
    items.push({
      id: "skills-import-reload",
      tone: "destructive",
      title: t("settings.skills.reloadRequired"),
      description: t("settings.skills.conflictReloadBody"),
      ...(onConflictResolve
        ? {
            action: {
              label: t("settings.skills.reloadAndReturn"),
              onClick: onConflictResolve,
            },
          }
        : {}),
    });
  }

  if (actionBlocked) {
    items.push({
      id: "skills-import-action-blocked",
      tone: "destructive",
      title: t("settings.skills.actionBlockedTitle"),
      description: t("settings.skills.actionBlockedBody"),
    });
  }

  if (expired) {
    items.push({
      id: "skills-import-expired",
      tone: "destructive",
      title: t("settings.skills.importExpired"),
    });
  }

  return items;
}
