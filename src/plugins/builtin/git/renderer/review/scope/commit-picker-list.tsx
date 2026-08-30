import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import { CONTROL_HEIGHT_CLASS } from "@pier/ui/interactive-density.ts";
import { PopoverContent } from "@pier/ui/popover.tsx";
import { scrollFadeClassName } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewCommitTarget } from "@shared/contracts/git/review.ts";
import type { GitCommit } from "@shared/contracts/git.ts";
import { SearchIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { GitCommitQuickPickRow } from "../../commit-quick-pick-row.tsx";
import { pluginText } from "../../plugin-text.ts";
import { useOptionalGitReviewCommitPickerSession } from "./commit-picker-context.tsx";
import {
  commitRangeVisual,
  committedRangeFromSelection,
  oidsForClickOrder,
  previewCommitRange,
  resolveCommitClick,
  visibleCommitCountInRange,
  visibleListedRange,
} from "./commit-range.ts";
import { CommitRangeGutter } from "./commit-range-gutter.tsx";

const COMMIT_SEARCH_LIMIT = 50;
const COMMIT_SEARCH_DEBOUNCE_MS = 150;

export function GitReviewCommitPickerList({
  context,
  gitRootPath,
  onSelectTarget,
  selectedFromOid,
  selectedOid,
}: {
  readonly context: RendererPluginContext;
  readonly gitRootPath: string;
  readonly onSelectTarget: (target: GitReviewCommitTarget) => void;
  readonly selectedFromOid: string | null;
  readonly selectedOid: string | null;
}): React.JSX.Element {
  const session = useOptionalGitReviewCommitPickerSession();
  const listId = useId();
  const hintId = `${listId}-hint`;
  const open = session?.open === true;
  const originOid = session?.originOid ?? null;
  const originOidRef = session?.originOidRef;
  const rememberCommit = session?.rememberCommit;
  const setOriginOid = session?.setOriginOid;
  const setOrderOids = session?.setOrderOids;
  const setRangeCount = session?.setRangeCount;
  const setVisibleOids = session?.setVisibleOids;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [hoverOid, setHoverOid] = useState<string | null>(null);
  const [highlightedOid, setHighlightedOid] = useState<string | null>(null);
  const selectedTarget = selectedCommitTargetFromOids(
    selectedOid,
    selectedFromOid
  );
  const listedOids = items.map((commit) => commit.hash);
  const orderOids = session?.orderOids ?? listedOids;
  const listedOrigin = originIfVisible(originOid, listedOids);
  useEffect(() => {
    const oids = items.map((commit) => commit.hash);
    setVisibleOids?.(oids);
    if (query === "") {
      setOrderOids?.(oids);
    }
  }, [items, query, setOrderOids, setVisibleOids]);
  const previewPointerOid = hoverOid ?? highlightedOid;
  const committedRange = visibleListedRange(
    committedRangeFromSelection(selectedTarget),
    listedOids
  );
  const hoverRange = visibleListedRange(
    previewCommitRange({
      hoverOid: previewPointerOid,
      newestFirstOids: listedOids,
      originOid: listedOrigin,
    }),
    listedOids
  );

  useEffect(() => {
    if (open) {
      return;
    }
    setQuery("");
    setHoverOid(null);
    setHighlightedOid(null);
  }, [open]);

  useEffect(() => {
    const oids = items.map((commit) => commit.hash);
    setHighlightedOid((current) => originIfVisible(current, oids));
    setHoverOid((current) => originIfVisible(current, oids));
  }, [items]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSearchFailed(false);
    const timer = setTimeout(() => {
      context.git
        .searchCommits(gitRootPath, { limit: COMMIT_SEARCH_LIMIT, query })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setLoading(false);
          if (result.status === "ok") {
            setSearchFailed(false);
            setItems(result.items);
            return;
          }
          setSearchFailed(true);
          setItems([]);
        })
        .catch(() => {
          if (!cancelled) {
            setLoading(false);
            setSearchFailed(true);
            setItems([]);
          }
        });
    }, COMMIT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [context, gitRootPath, open, query]);

  const applyClick = (
    clickedOid: string,
    itemsSnapshot: readonly GitCommit[]
  ) => {
    const snapshotOids = itemsSnapshot.map((commit) => commit.hash);
    const origin = originOidRef?.current ?? null;
    const result = resolveCommitClick({
      clickedOid,
      newestFirstOids: oidsForClickOrder(
        origin,
        clickedOid,
        orderOids,
        snapshotOids
      ),
      originOid: origin,
    });
    if (originOidRef) {
      originOidRef.current = result.originOid;
    }
    setOriginOid?.(result.originOid);
    setHighlightedOid(clickedOid);
    if (
      result.target.fromOid === undefined ||
      result.target.fromOid === result.target.oid
    ) {
      setRangeCount?.(null);
    } else {
      setRangeCount?.(
        visibleCommitCountInRange(
          result.target.fromOid,
          result.target.oid,
          oidsForClickOrder(origin, clickedOid, orderOids, snapshotOids)
        )
      );
    }
    const match = itemsSnapshot.find(
      (commit) => commit.hash === result.target.oid
    );
    if (match) {
      rememberCommit?.({ message: match.message, oid: result.target.oid });
    }
    onSelectTarget(result.target);
  };

  const emptyText = commitPickerEmptyText(context, loading, searchFailed);
  const hasOrigin = originOid !== null;
  const hint = hasOrigin
    ? pluginText(
        context,
        "reviewScopeCommitRangePendingHint",
        "Your last check is the start. Check another commit to review that stretch, or hover to preview."
      )
    : pluginText(
        context,
        "reviewScopeCommitRangeHint",
        "Check a box to review that commit."
      );

  useEffect(() => {
    if (highlightedOid === null) {
      return;
    }
    const row = document.getElementById(
      commitPickerRowId(listId, highlightedOid)
    );
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedOid, listId]);

  const searchPlaceholder = pluginText(
    context,
    "reviewScopeCommitSearchPlaceholder",
    "Search: text, #hash, @author, :path"
  );
  const moveHighlight = (key: string) => {
    setHoverOid(null);
    if (key === "Home") {
      setHighlightedOid(listedOids[0] ?? null);
      return;
    }
    if (key === "End") {
      setHighlightedOid(listedOids.at(-1) ?? null);
      return;
    }
    setHighlightedOid((current) =>
      oidAtOffset(listedOids, current, key === "ArrowDown" ? 1 : -1)
    );
  };

  return (
    <PopoverContent align="start" className="w-96 p-0">
      <div className="flex flex-col overflow-hidden rounded-3xl bg-popover p-1 text-popover-foreground">
        <div className="p-1 pb-0">
          <InputGroup className={cn(CONTROL_HEIGHT_CLASS, "bg-input/50")}>
            <InputGroupInput
              aria-activedescendant={
                highlightedOid === null
                  ? undefined
                  : commitPickerRowId(listId, highlightedOid)
              }
              aria-autocomplete="list"
              aria-controls={listId}
              aria-describedby={hintId}
              aria-expanded
              aria-haspopup="listbox"
              aria-label={searchPlaceholder}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp" ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  event.preventDefault();
                  moveHighlight(event.key);
                  return;
                }
                if (event.key !== "Enter" || highlightedOid === null) {
                  return;
                }
                event.preventDefault();
                applyClick(highlightedOid, items);
              }}
              placeholder={searchPlaceholder}
              role="combobox"
              value={query}
            />
            <InputGroupAddon>
              <SearchIcon className="size-4 shrink-0 opacity-50" />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div
          className={cn(
            "max-h-72 scroll-py-1 overflow-y-auto overflow-x-hidden p-1 outline-none",
            scrollFadeClassName({ fade: "vertical", profile: "short" })
          )}
          data-scrollbar="none"
          id={listId}
          role="listbox"
        >
          {items.length === 0 ? (
            <div className="py-6 text-center text-sm">{emptyText}</div>
          ) : (
            items.map((commit) => {
              const highlighted = highlightedOid === commit.hash;
              const hovered = hoverOid === commit.hash;
              const visual = commitRangeVisual(
                commit.hash,
                listedOrigin,
                committedRange,
                hoverRange,
                listedOids,
                { highlighted, hovered }
              );
              const status = commitRangeOptionStatus(context, visual);
              return (
                <div
                  aria-selected={visual.checked}
                  className="relative flex items-stretch gap-2 px-2"
                  data-commit-oid={commit.hash}
                  data-highlighted={highlighted ? "true" : undefined}
                  data-slot="commit-picker-row"
                  id={commitPickerRowId(listId, commit.hash)}
                  key={commit.hash}
                  onPointerDown={(event) => {
                    event.preventDefault();
                  }}
                  role="option"
                  tabIndex={-1}
                >
                  <CommitRangeGutter
                    checked={visual.checked}
                    committedRole={visual.committedRole}
                    highlighted={highlighted}
                    hovered={hovered}
                    marker={visual.marker}
                    onHoverChange={(hovered) => {
                      setHoverOid((current) => {
                        if (hovered) {
                          return commit.hash;
                        }
                        return current === commit.hash ? null : current;
                      });
                    }}
                    onToggle={() => {
                      applyClick(commit.hash, items);
                    }}
                    previewRole={visual.previewRole}
                    testId={`git-review-commit-checkbox-${commit.hash}`}
                  />
                  <span className="min-w-0 flex-1 py-1">
                    <GitCommitQuickPickRow commit={commit} showIcon={false} />
                    {status === null ? null : (
                      <span className="sr-only">{status}</span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div
          className="border-border border-t px-2.5 py-1.5 text-muted-foreground text-xs"
          id={hintId}
        >
          {hint}
        </div>
      </div>
    </PopoverContent>
  );
}

function selectedCommitTargetFromOids(
  selectedOid: string | null,
  selectedFromOid: string | null
): GitReviewCommitTarget | null {
  if (selectedOid === null) {
    return null;
  }
  if (selectedFromOid === null || selectedFromOid === selectedOid) {
    return { kind: "commit", oid: selectedOid };
  }
  return { fromOid: selectedFromOid, kind: "commit", oid: selectedOid };
}

function commitPickerRowId(listId: string, oid: string): string {
  return `${listId}-option-${oid}`;
}

function commitPickerEmptyText(
  context: RendererPluginContext,
  loading: boolean,
  searchFailed: boolean
): string {
  if (loading) {
    return pluginText(context, "reviewScopeSearching", "Searching…");
  }
  if (searchFailed) {
    return pluginText(
      context,
      "reviewScopeCommitsLoadFailed",
      "Couldn't load commits. Try again."
    );
  }
  return pluginText(context, "reviewScopeNoCommits", "No matching commits");
}

function oidAtOffset(
  oids: readonly string[],
  current: string | null,
  delta: number
): string | null {
  if (oids.length === 0) {
    return null;
  }
  const first = oids[0];
  const last = oids.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  if (current === null) {
    return delta > 0 ? first : last;
  }
  const index = oids.indexOf(current);
  if (index < 0) {
    return delta > 0 ? first : last;
  }
  return oids[index + delta] ?? oids[index] ?? null;
}

function originIfVisible(
  originOid: string | null,
  newestFirstOids: readonly string[]
): string | null {
  if (originOid === null || !newestFirstOids.includes(originOid)) {
    return null;
  }
  return originOid;
}

function commitRangeOptionStatus(
  context: RendererPluginContext,
  visual: ReturnType<typeof commitRangeVisual>
): string | null {
  const role = visual.previewRole ?? visual.committedRole;
  if (role === "start") {
    return pluginText(
      context,
      "reviewScopeCommitRangeOptionStart",
      "Range start"
    );
  }
  if (role === "end") {
    return pluginText(context, "reviewScopeCommitRangeOptionEnd", "Range end");
  }
  if (role === "middle") {
    return pluginText(
      context,
      "reviewScopeCommitRangeOptionInRange",
      "In this range"
    );
  }
  if (visual.checked) {
    return pluginText(context, "reviewScopeCommitSelected", "Selected");
  }
  return null;
}
