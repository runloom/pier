import { Zap } from "lucide-react";
import type { ComposerSkillQueryStatus } from "./composer-skill-query.ts";
import type { ComposerSkillSuggestItem } from "./composer-skill-suggest.ts";
import {
  ComposerSuggestList,
  type ComposerSuggestRowModel,
} from "./composer-suggest-list.tsx";

export const SKILL_SUGGEST_LISTBOX_ID = "terminal-composer-skill-listbox";

export interface SkillSuggestPopupProps {
  activeIndex: number;
  emptyProject: boolean;
  emptyProjectBody: string;
  emptyProjectTitle: string;
  items: readonly ComposerSkillSuggestItem[];
  noResults: string;
  notSupportedBody: string;
  notSupportedTitle: string;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  placeholder: string;
  showNotSupported: boolean;
  status: ComposerSkillQueryStatus;
}

export function SkillSuggestPopup({
  activeIndex,
  emptyProject,
  emptyProjectBody,
  emptyProjectTitle,
  items,
  noResults,
  notSupportedBody,
  notSupportedTitle,
  onHover,
  onSelect,
  placeholder,
  showNotSupported,
  status,
}: SkillSuggestPopupProps) {
  const showEmpty = emptyProject || showNotSupported;
  const rows: ComposerSuggestRowModel[] = items.map((item) => {
    const description = item.description.trim();
    // Placeholder strings some skills put in frontmatter are not useful copy.
    const detail =
      description.length > 0 &&
      description !== "(no description)" &&
      description !== ">-" &&
      description !== ">"
        ? description
        : null;
    return {
      detail,
      icon: <Zap aria-hidden="true" />,
      key: `${item.source}:${item.id}`,
      // Name only — no `/` prefix or source badge in the list (insert still
      // uses agent-native invokeText).
      label: item.id,
      meta: null,
    };
  });

  let emptyBody: string | null = null;
  let emptyTitle: string | null = null;
  if (emptyProject) {
    emptyBody = emptyProjectBody;
    emptyTitle = emptyProjectTitle;
  } else if (showNotSupported) {
    emptyBody = notSupportedBody;
    emptyTitle = notSupportedTitle;
  }

  return (
    <ComposerSuggestList
      activeIndex={activeIndex}
      emptyBody={emptyBody}
      emptyTitle={emptyTitle}
      items={rows}
      listboxId={SKILL_SUGGEST_LISTBOX_ID}
      loading={status === "loading"}
      loadingLabel={placeholder}
      noResults={noResults}
      onHover={onHover}
      onSelect={onSelect}
      optionIdPrefix="terminal-composer-skill-option"
      showEmpty={showEmpty}
      testId="terminal-composer-skill-popup"
    />
  );
}
