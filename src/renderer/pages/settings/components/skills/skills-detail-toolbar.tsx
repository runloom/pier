import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Field, FieldLabel } from "@pier/ui/field.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import { Search, Sparkles } from "lucide-react";
import type { Translate } from "./skills-shared.tsx";

/**
 * Unified-list toolbar (search + filter + count) and empty states, split
 * from skills-project-detail.tsx (file-size cap). Behavior unchanged.
 */

/**
 * Filter axis = SOURCE (industry form: Cursor groups User/Project rules,
 * Claude Code /skills groups personal/project/plugin). Enabled state is
 * visible on the row switch; health shows as inline badges — neither is a
 * list category.
 */
export type SkillsFilterId = "all" | "managed" | "project" | "user-global";

export function SkillsListToolbar({
  query,
  filter,
  shownCount,
  totalCount,
  t,
  onQueryChange,
  onFilterChange,
}: {
  query: string;
  filter: SkillsFilterId;
  shownCount: number;
  totalCount: number;
  t: Translate;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: SkillsFilterId) => void;
}) {
  return (
    <>
      <Field>
        <FieldLabel className="sr-only" htmlFor="skills-search">
          {t("settings.skills.searchPlaceholder")}
        </FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            id="skills-search"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("settings.skills.searchPlaceholder")}
            value={query}
          />
        </InputGroup>
      </Field>

      <ToggleGroup
        aria-label={t("settings.skills.filterGroupLabel")}
        className="flex-wrap"
        onValueChange={(value) => {
          if (!value) return;
          onFilterChange(value as SkillsFilterId);
        }}
        type="single"
        value={filter}
        variant="outline"
      >
        <ToggleGroupItem value="all">
          {t("settings.skills.filterAll")}
        </ToggleGroupItem>
        <ToggleGroupItem value="managed">
          {t("settings.skills.filterManaged")}
        </ToggleGroupItem>
        <ToggleGroupItem value="project">
          {t("settings.skills.filterProject")}
        </ToggleGroupItem>
        <ToggleGroupItem value="user-global">
          {t("settings.skills.filterUserGlobal")}
        </ToggleGroupItem>
      </ToggleGroup>

      <p className="text-muted-foreground text-xs" role="status">
        {t("settings.skills.resultCount", {
          count: totalCount,
          shown: shownCount,
          total: totalCount,
        })}
      </p>
    </>
  );
}

export function SkillsNoResults({
  t,
  onClearFilters,
}: {
  t: Translate;
  onClearFilters: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("settings.skills.noResultsTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("settings.skills.noResultsDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onClearFilters} type="button" variant="outline">
          {t("settings.skills.clearFilters")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function SkillsEmptyState({
  t,
  onImportFolder,
}: {
  t: Translate;
  onImportFolder: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("settings.skills.detailEmptyTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("settings.skills.detailEmptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onImportFolder} type="button">
          <Sparkles data-icon="inline-start" />
          {t("settings.skills.addFromFolder")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
