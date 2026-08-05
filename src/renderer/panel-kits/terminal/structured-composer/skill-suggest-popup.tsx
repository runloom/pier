import { Zap } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import type { ComposerSkillQueryStatus } from "./composer-skill-query.ts";
import type {
  ComposerSkillSource,
  ComposerSkillSuggestItem,
} from "./composer-skill-suggest.ts";
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
  noAgent: boolean;
  noAgentBody: string;
  noAgentTitle: string;
  noResults: string;
  notSupportedBody: string;
  notSupportedTitle: string;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  placeholder: string;
  showNotSupported: boolean;
  status: ComposerSkillQueryStatus;
}

function skillSourceMetaKey(
  source: ComposerSkillSource
):
  | "terminal.composer.skillSourceBundled"
  | "terminal.composer.skillSourceGlobal"
  | "terminal.composer.skillSourceInRepo"
  | "terminal.composer.skillSourceProject" {
  switch (source) {
    case "bundled":
      return "terminal.composer.skillSourceBundled";
    case "user-global":
      return "terminal.composer.skillSourceGlobal";
    case "project-unmanaged":
      return "terminal.composer.skillSourceInRepo";
    case "project":
      return "terminal.composer.skillSourceProject";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

export function SkillSuggestPopup({
  activeIndex,
  emptyProject,
  emptyProjectBody,
  emptyProjectTitle,
  items,
  noAgent,
  noAgentBody,
  noAgentTitle,
  noResults,
  notSupportedBody,
  notSupportedTitle,
  onHover,
  onSelect,
  placeholder,
  showNotSupported,
  status,
}: SkillSuggestPopupProps) {
  const t = useT();
  const showEmpty = emptyProject || noAgent || showNotSupported;
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
      // Id as primary label; insert still uses agent-native invokeText.
      label: item.id,
      meta: t(skillSourceMetaKey(item.source)),
    };
  });

  let emptyBody: string | null = null;
  let emptyTitle: string | null = null;
  if (emptyProject) {
    emptyBody = emptyProjectBody;
    emptyTitle = emptyProjectTitle;
  } else if (noAgent) {
    emptyBody = noAgentBody;
    emptyTitle = noAgentTitle;
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
