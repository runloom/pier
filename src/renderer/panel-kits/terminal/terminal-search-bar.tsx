import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import type { TerminalSearchStateEvent } from "@shared/contracts/terminal.ts";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { registerTerminalElementWebOverlay } from "@/stores/terminal-input-routing.store.ts";
import { useTerminalOverlayFocus } from "@/stores/terminal-overlay-focus.store.ts";

interface TerminalSearchBarProps {
  focusRequest: number;
  onClose: () => void;
  panelId: string;
  visible: boolean;
}

interface SearchState {
  selected: number;
  total: number;
}

const EMPTY_SEARCH_STATE: SearchState = {
  selected: -1,
  total: 0,
};

function normalizeSearchState(event: TerminalSearchStateEvent): SearchState {
  const total = Number.isFinite(event.total) ? Math.max(0, event.total) : 0;
  const selected =
    total > 0 && Number.isFinite(event.selected) ? event.selected : -1;
  return {
    selected,
    total,
  };
}

function reportSearchError(action: string, err: unknown): void {
  console.error(`[terminal-search] ${action} failed:`, err);
}

export function TerminalSearchBar({
  focusRequest,
  onClose,
  panelId,
  visible,
}: TerminalSearchBarProps) {
  const t = useT();
  const rootRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] =
    useState<SearchState>(EMPTY_SEARCH_STATE);
  const searchId = `terminal-search:${panelId}:keyboard`;
  const activeOverlayId = useTerminalOverlayFocus(
    (state) => state.activeOverlayId
  );

  // 打开（可见转 true）时激活为活跃共存浮层；关闭/卸载时让出（若仍活跃）。
  useEffect(() => {
    if (!visible) {
      return;
    }
    useTerminalOverlayFocus.getState().activateOverlay(searchId);
    return () => {
      useTerminalOverlayFocus.getState().deactivateOverlay(searchId);
    };
  }, [visible, searchId]);

  // 终端意图让出键盘后（activeOverlayId 不再是本栏），blur 输入框保持视觉一致；
  // 搜索栏仍然挂载可见，仅键盘归属移交终端。
  useEffect(() => {
    if (visible && activeOverlayId !== searchId) {
      inputRef.current?.blur();
    }
  }, [visible, activeOverlayId, searchId]);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const registration = registerTerminalElementWebOverlay(
      `terminal-search:${panelId}`,
      root
    );
    return () => {
      registration.dispose();
    };
  }, [visible, panelId]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const request = focusRequest;
    queueMicrotask(() => {
      if (request !== focusRequest) {
        return;
      }
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [visible, focusRequest]);

  useEffect(
    () =>
      window.pier.terminal.onSearchState((event) => {
        if (event.panelId !== panelId) {
          return;
        }
        setSearchState(normalizeSearchState(event));
      }),
    [panelId]
  );

  const endSearch = () => {
    window.pier.terminal
      .endSearch(panelId)
      .catch((err: unknown) => reportSearchError("end", err));
  };

  const runSearch = (nextQuery: string) => {
    setQuery(nextQuery);
    if (nextQuery === "") {
      setSearchState(EMPTY_SEARCH_STATE);
      endSearch();
      return;
    }
    window.pier.terminal
      .search(panelId, nextQuery)
      .then((result) => {
        if (!result.ok) {
          console.error("[terminal-search] search failed:", result.error);
        }
      })
      .catch((err: unknown) => reportSearchError("search", err));
  };

  const navigate = (direction: "next" | "previous") => {
    if (query === "") {
      return;
    }
    window.pier.terminal
      .navigateSearch(panelId, direction)
      .then((result) => {
        if (!result.ok) {
          console.error("[terminal-search] navigate failed:", result.error);
        }
      })
      .catch((err: unknown) => reportSearchError("navigate", err));
  };

  const close = () => {
    setQuery("");
    setSearchState(EMPTY_SEARCH_STATE);
    endSearch();
    useTerminalOverlayFocus.getState().deactivateOverlay(searchId);
    onClose();
  };

  const matchText = (() => {
    if (query === "") {
      return "";
    }
    if (searchState.total <= 0) {
      return t("terminal.search.noMatches");
    }
    const index = searchState.selected >= 0 ? searchState.selected + 1 : 0;
    return t("terminal.search.matchCount", {
      index: String(index),
      total: String(searchState.total),
    });
  })();

  if (!visible) {
    return null;
  }

  return (
    <search
      aria-label={t("terminal.search.label")}
      className="pointer-events-auto absolute top-3 right-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-background/40 shadow-lg"
      data-terminal-search-bar=""
      data-testid="terminal-search-bar"
      ref={rootRef}
    >
      <div className="relative w-52 min-w-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-label={t("terminal.search.placeholder")}
          className="h-7 pl-7 text-xs outline-none placeholder:text-muted-foreground/65"
          data-testid="terminal-search-input"
          onChange={(event) => runSearch(event.currentTarget.value)}
          onFocus={() =>
            useTerminalOverlayFocus.getState().activateOverlay(searchId)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              navigate(event.shiftKey ? "previous" : "next");
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          placeholder={t("terminal.search.placeholder")}
          ref={inputRef}
          type="text"
          value={query}
        />
      </div>
      {query ? (
        <Badge
          className="text-muted-foreground tabular-nums"
          data-testid="terminal-search-match-count"
          variant="secondary"
        >
          {matchText}
        </Badge>
      ) : null}
      <Button
        aria-label={t("terminal.search.previous")}
        className="shrink-0"
        onClick={() => navigate("previous")}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={t("terminal.search.next")}
        className="shrink-0"
        onClick={() => navigate("next")}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={t("terminal.search.close")}
        className="shrink-0"
        onClick={close}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X />
      </Button>
    </search>
  );
}
