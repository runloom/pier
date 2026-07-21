import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  ProjectSkillView,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { useId } from "react";
import {
  AgentEffectSummary,
  sourceLabel,
  type Translate,
} from "./skills-shared.tsx";

/**
 * Unified-list rows (design v8 §7.3), split from skills-project-detail.tsx
 * (file-size cap). The caller renders these inside its own ItemGroup.
 */

export function ManagedSkillRow({
  skill,
  enabled,
  disabled,
  t,
  onToggle,
  onOpenSkill,
}: {
  skill: ProjectSkillView;
  enabled: boolean;
  disabled: boolean;
  t: Translate;
  onToggle: (skillId: string, enabled: boolean) => void;
  onOpenSkill: (skillId: string) => void;
}) {
  const isSystem = skill.managedBy === "pier-system";
  const titleId = useId();
  const enableLabelId = useId();
  const openLabelId = useId();
  function renderPrimaryAction() {
    if (isSystem) {
      return null;
    }
    return (
      <>
        <span className="sr-only" id={enableLabelId}>
          {t("settings.skills.enableSkill")}
        </span>
        <Switch
          aria-labelledby={`${enableLabelId} ${titleId}`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => {
            onToggle(skill.id, checked);
          }}
        />
      </>
    );
  }

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
            ) : (
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
        </ItemActions>
      </Item>
    </li>
  );
}

/**
 * Layer-3 user-global row: read-only fact with a "view" entry into the
 * read-only detail (Cursor form: any listed skill can be opened and read).
 */
export function UserGlobalSkillRow({
  entry,
  t,
  onView,
}: {
  entry: UserGlobalSkillView;
  t: Translate;
  onView: (entry: UserGlobalSkillView) => void;
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
