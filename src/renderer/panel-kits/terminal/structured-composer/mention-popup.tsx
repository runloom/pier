import { PierFileIcon } from "@pier/ui/file/icon.tsx";
import type { FilePathQueryItem } from "@shared/contracts/file/query.ts";
import type { ComposerPathQueryStatus } from "./composer-path-query.ts";
import {
  ComposerSuggestList,
  type ComposerSuggestRowModel,
} from "./composer-suggest-list.tsx";

export const MENTION_LISTBOX_ID = "terminal-composer-mention-listbox";

export interface MentionPopupProps {
  activeIndex: number;
  emptyProject: boolean;
  emptyProjectBody: string;
  emptyProjectTitle: string;
  items: readonly FilePathQueryItem[];
  noResults: string;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  placeholder: string;
  status: ComposerPathQueryStatus;
}

function pathParts(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) {
    return { dir: "", name: path };
  }
  return { dir: path.slice(0, slash), name: path.slice(slash + 1) };
}

export function MentionPopup({
  activeIndex,
  emptyProject,
  emptyProjectBody,
  emptyProjectTitle,
  items,
  noResults,
  onHover,
  onSelect,
  placeholder,
  status,
}: MentionPopupProps) {
  const rows: ComposerSuggestRowModel[] = items.map((item) => {
    const { dir, name } = pathParts(item.path);
    return {
      detail: dir.length > 0 ? dir : null,
      icon: <PierFileIcon aria-hidden="true" fileName={name} size={16} />,
      key: item.path,
      label: name,
      meta: null,
    };
  });

  return (
    <ComposerSuggestList
      activeIndex={activeIndex}
      emptyBody={emptyProject ? emptyProjectBody : null}
      emptyTitle={emptyProject ? emptyProjectTitle : null}
      items={rows}
      listboxId={MENTION_LISTBOX_ID}
      loading={status === "loading"}
      loadingLabel={placeholder}
      noResults={noResults}
      onHover={onHover}
      onSelect={onSelect}
      optionIdPrefix="terminal-composer-mention-option"
      showEmpty={emptyProject}
      testId="terminal-composer-mention-popup"
    />
  );
}
