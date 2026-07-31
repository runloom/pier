import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  ProjectSkillView,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { useId } from "react";
import { AgentEffectSummary, sourceLabel, type Translate } from "./shared.tsx";

/**
 * Unified-list rows (design v8 §7.3 / IA v5), split from skills-project-detail.tsx
 * (file-size cap). The caller renders these inside its own ItemGroup.
 *
 * Enablement is edited on the skill detail matrix (discovery channels), not
 * via a list Switch.
 *
 * Pier-bound: unbind only (always-include = locked, no remove). No content open.
 * User-global: jump to Pier Home (no in-project open/edit).
 * Project-owned / system: open in-project detail.
 */

export function ManagedSkillRow({
  skill,
  disabled,
  t,
  onOpenSkill,
  onUnbindPier,
}: {
  skill: ProjectSkillView;
  disabled: boolean;
  t: Translate;
  onOpenSkill: (skillId: string) => void;
  onUnbindPier?: (skillId: string) => void;
}) {
  const isSystem = skill.managedBy === "pier-system";
  const isPierBound = skill.managedBy === "pier-bound";
  const titleId = useId();
  const openLabelId = useId();

  function renderPrimaryAction() {
    if (isSystem) {
      return null;
    }
    if (isPierBound) {
      if (skill.alwaysInclude) {
        return (
          <Badge variant="outline">
            {t("settings.skills.alwaysIncludeBadge")}
          </Badge>
        );
      }
      if (!onUnbindPier) return null;
      return (
        <Button
          disabled={disabled}
          onClick={() => {
            onUnbindPier(skill.id);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("settings.skills.removeFromProject")}
        </Button>
      );
    }
    return null;
  }

  // Pier-bound content is edited in Pier Home only (IA v5 §0.3).
  const canOpenContent = !isPierBound;

  return (
    <li
      className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      data-skill-id={skill.id}
      tabIndex={-1}
    >
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>
            <span id={titleId}>{skill.name || skill.id}</span>
            {isSystem ? (
              <Badge variant="secondary">
                {t("settings.skills.systemBadge")}
              </Badge>
            ) : null}
            {isPierBound ? (
              <Badge variant="secondary">
                {t("settings.skills.pierBoundBadge")}
              </Badge>
            ) : null}
            {isSystem || isPierBound ? null : (
              <Badge variant="outline">{sourceLabel(skill, t)}</Badge>
            )}
            {skill.issueIds.some((id) => id.startsWith("library-drift")) ? (
              <Badge variant="destructive">
                {t("settings.skills.driftBadge")}
              </Badge>
            ) : null}
            {skill.issueIds.some((id) => id.startsWith("missing-source")) ? (
              <Badge variant="destructive">
                {t("settings.skills.missingBadge")}
              </Badge>
            ) : null}
          </ItemTitle>
          <ItemDescription>{skill.description || skill.id}</ItemDescription>
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <AgentEffectSummary effects={skill.effects} t={t} />
          </div>
        </ItemContent>
        <ItemActions>
          {renderPrimaryAction()}
          {canOpenContent ? (
            <>
              <span className="sr-only" id={openLabelId}>
                {t("settings.skills.open")}
              </span>
              <Button
                aria-labelledby={`${openLabelId} ${titleId}`}
                onClick={() => {
                  onOpenSkill(skill.id);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("settings.skills.open")}
              </Button>
            </>
          ) : null}
        </ItemActions>
      </Item>
    </li>
  );
}

/**
 * Layer-3 user-global row: read-only discovery fact in the project list.
 * No open/edit here — content is managed under Pier Home (agent-global RO).
 */
export function UserGlobalSkillRow({
  entry,
  t,
}: {
  entry: UserGlobalSkillView;
  t: Translate;
}) {
  const titleId = useId();
  return (
    <li>
      <Item className={cn("border-dashed")} variant="outline">
        <ItemContent>
          <ItemTitle>
            <span id={titleId}>{entry.name || entry.directoryName}</span>
            <Badge variant="outline">
              {t("settings.skills.userGlobalBadge")}
            </Badge>
          </ItemTitle>
          <ItemDescription>
            <span className="font-mono">{`${entry.root}/${entry.directoryName}`}</span>
          </ItemDescription>
          {entry.description ? (
            <ItemDescription>{entry.description}</ItemDescription>
          ) : null}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <AgentEffectSummary effects={entry.effects} t={t} />
          </div>
        </ItemContent>
      </Item>
    </li>
  );
}

/**
 * Layer-5 project-directory row: read-only fact with a "view" entry; the
 * adoption action lives on the read-only detail page.
 */
export function UnmanagedSkillRow({
  entry,
  t,
  onView,
}: {
  entry: UnmanagedSkillView;
  t: Translate;
  onView: (entry: UnmanagedSkillView) => void;
}) {
  const titleId = useId();
  const viewLabelId = useId();
  return (
    <li>
      <Item className={cn("border-dashed")} variant="outline">
        <ItemContent>
          <ItemTitle>
            <span id={titleId}>{entry.name || entry.directoryName}</span>
            <Badge variant="outline">
              {t("settings.skills.unmanagedBadge")}
            </Badge>
          </ItemTitle>
          <ItemDescription>
            <span className="font-mono">{`${entry.root}/${entry.directoryName}`}</span>
          </ItemDescription>
          {entry.description ? (
            <ItemDescription>{entry.description}</ItemDescription>
          ) : null}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <AgentEffectSummary effects={entry.effects} t={t} />
          </div>
        </ItemContent>
        <ItemActions>
          <Button
            aria-labelledby={`${viewLabelId} ${titleId}`}
            onClick={() => {
              onView(entry);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span id={viewLabelId}>{t("settings.skills.open")}</span>
          </Button>
        </ItemActions>
      </Item>
    </li>
  );
}
