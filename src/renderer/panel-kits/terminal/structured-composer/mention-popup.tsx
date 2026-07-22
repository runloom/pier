import { PierFileIcon } from "@pier/ui/file-icon.tsx";
import { MENU_ITEM_DENSITY_CLASS } from "@pier/ui/interactive-density.ts";
import { cn } from "@pier/ui/utils.ts";
import type { FilePathQueryItem } from "@shared/contracts/file-query.ts";
import type { ComposerPathQueryStatus } from "./composer-path-query.ts";

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
  return (
    <div
      className={cn(
        // Position comes from ComposerAutocompletePortal (fixed above input).
        "max-h-56 w-full min-w-0",
        "overflow-y-auto overflow-x-hidden rounded-xl border bg-popover p-1 shadow-md",
        "no-scrollbar"
      )}
      data-scrollbar="none"
      data-testid="terminal-composer-mention-popup"
      id={MENTION_LISTBOX_ID}
      role="listbox"
    >
      {emptyProject ? (
        <div className="px-2 py-1.5">
          <div className="font-medium text-foreground text-xs/tight">
            {emptyProjectTitle}
          </div>
          <div className="mt-0.5 text-muted-foreground text-xs/tight">
            {emptyProjectBody}
          </div>
        </div>
      ) : null}

      {!emptyProject && status === "loading" && items.length === 0 ? (
        <div className="px-2 py-1.5 text-muted-foreground text-xs/tight">
          {placeholder}
        </div>
      ) : null}

      {!emptyProject &&
      (status === "done" || status === "error") &&
      items.length === 0 ? (
        <div className="px-2 py-1.5 text-muted-foreground text-xs/tight">
          {noResults}
        </div>
      ) : null}

      {emptyProject
        ? null
        : items.map((item, index) => {
            const { dir, name } = pathParts(item.path);
            return (
              <button
                aria-selected={index === activeIndex}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left",
                  MENU_ITEM_DENSITY_CLASS,
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/50"
                )}
                data-testid={`terminal-composer-mention-item-${index}`}
                id={`terminal-composer-mention-option-${index}`}
                key={item.path}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(index);
                }}
                onMouseEnter={() => onHover(index)}
                role="option"
                type="button"
              >
                <PierFileIcon
                  aria-hidden="true"
                  className="shrink-0"
                  fileName={name}
                  size={14}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                  <span className="truncate font-medium font-mono text-xs/tight">
                    {name}
                  </span>
                  {dir ? (
                    <span
                      className={cn(
                        "truncate font-mono text-[10px]/tight",
                        index === activeIndex
                          ? "text-accent-foreground/70"
                          : "text-muted-foreground"
                      )}
                    >
                      {dir}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
    </div>
  );
}
