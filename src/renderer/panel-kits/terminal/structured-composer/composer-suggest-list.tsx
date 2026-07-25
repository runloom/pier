import { MENU_ITEM_DENSITY_CLASS } from "@pier/ui/interactive-density.ts";
import { cn } from "@pier/ui/utils.ts";
import type { ReactNode } from "react";
import { COMPOSER_SUGGEST_MAX_HEIGHT_PX } from "./composer-suggest-layout.ts";

/**
 * Shared Codex-style suggestion shell for skill / @ file / # attachment lists.
 * Parent portal supplies width (= composer chrome). This shell is always w-full.
 */

export interface ComposerSuggestRowModel {
  /** Optional trailing / secondary text (description, dir, …). */
  detail?: string | null;
  /** Leading icon node (size-4). */
  icon: ReactNode;
  key: string;
  /** Primary label (skill id, file name, …). */
  label: string;
  /** Optional source / meta chip text after the label. */
  meta?: string | null;
}

export interface ComposerSuggestListProps {
  activeIndex: number;
  emptyBody?: string | null;
  emptyTitle?: string | null;
  items: readonly ComposerSuggestRowModel[];
  listboxId: string;
  loading?: boolean;
  loadingLabel?: string;
  noResults?: string | null;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  optionIdPrefix: string;
  showEmpty?: boolean;
  testId: string;
}

export function ComposerSuggestList({
  activeIndex,
  emptyBody,
  emptyTitle,
  items,
  listboxId,
  loading = false,
  loadingLabel,
  noResults,
  onHover,
  onSelect,
  optionIdPrefix,
  showEmpty = false,
  testId,
}: ComposerSuggestListProps) {
  const showLoading = loading && items.length === 0 && !showEmpty;
  const showNoResults =
    !(showEmpty || loading) && items.length === 0 && Boolean(noResults);

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-popover shadow-md",
        "p-1"
      )}
      data-testid={testId}
      id={listboxId}
      role="listbox"
      style={{ maxHeight: COMPOSER_SUGGEST_MAX_HEIGHT_PX }}
    >
      <div
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        data-scrollbar="none"
      >
        {showEmpty ? (
          <div className="px-2 py-1.5">
            {emptyTitle ? (
              <div className="font-medium text-foreground text-xs/tight">
                {emptyTitle}
              </div>
            ) : null}
            {emptyBody ? (
              <div className="mt-0.5 text-muted-foreground text-xs/tight">
                {emptyBody}
              </div>
            ) : null}
          </div>
        ) : null}

        {showLoading ? (
          <div className="px-2 py-1.5 text-muted-foreground text-xs/tight">
            {loadingLabel}
          </div>
        ) : null}

        {showNoResults ? (
          <div className="px-2 py-1.5 text-muted-foreground text-xs/tight">
            {noResults}
          </div>
        ) : null}

        {showEmpty
          ? null
          : items.map((item, index) => {
              const active = index === activeIndex;
              return (
                <button
                  aria-selected={active}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left",
                    MENU_ITEM_DENSITY_CLASS,
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50"
                  )}
                  data-testid={`${testId}-item-${index}`}
                  id={`${optionIdPrefix}-${index}`}
                  key={item.key}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(index);
                  }}
                  onMouseEnter={() => onHover(index)}
                  role="option"
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                    {item.icon}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={cn(
                        "shrink-0 truncate font-medium text-sm/tight",
                        item.detail || item.meta ? "max-w-[40%]" : "min-w-0"
                      )}
                    >
                      {item.label}
                    </span>
                    {item.meta ? (
                      <span
                        className={cn(
                          "shrink-0 text-xs/tight",
                          active
                            ? "text-accent-foreground/70"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.meta}
                      </span>
                    ) : null}
                    {item.detail ? (
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs/tight",
                          active
                            ? "text-accent-foreground/70"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.meta ? `· ${item.detail}` : item.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
      </div>
    </div>
  );
}
