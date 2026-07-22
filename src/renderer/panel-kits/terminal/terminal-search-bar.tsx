import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import type { TerminalSearchStateEvent } from "@shared/contracts/terminal.ts";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { activeTerminalPanelId } from "@/lib/actions/renderer-action-runtime.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  useTerminalOverlayFocus,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import { acquireTerminalEscapeShortcut } from "./terminal-escape-shortcut.ts";

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

/** 与 use-keybindings 一致的 NSEvent 修饰位。 */
const NS_FLAG_SHIFT = 0x2_00_00;
const NS_FLAG_CONTROL = 0x4_00_00;
const NS_FLAG_OPTION = 0x8_00_00;
const NS_FLAG_COMMAND = 0x10_00_00;

function hasNsFlag(modifierFlags: number, flag: number): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: NSEvent.modifierFlags 位掩码
  return (modifierFlags & flag) !== 0;
}

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

function isBareEscapeForward(modifierFlags: number, chars: string): boolean {
  if (
    hasNsFlag(modifierFlags, NS_FLAG_COMMAND) ||
    hasNsFlag(modifierFlags, NS_FLAG_CONTROL) ||
    hasNsFlag(modifierFlags, NS_FLAG_OPTION) ||
    hasNsFlag(modifierFlags, NS_FLAG_SHIFT)
  ) {
    return false;
  }
  return chars === "\u{1b}" || chars.toLowerCase() === "escape";
}

export function TerminalSearchBar({
  focusRequest,
  onClose,
  panelId,
  visible,
}: TerminalSearchBarProps) {
  const t = useT();
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
    useTerminalStore.getState().activateOverlay(searchId);
    return () => {
      useTerminalStore.getState().deactivateOverlay(searchId);
    };
  }, [visible, searchId]);

  // 终端意图让出键盘后（activeOverlayId 不再是本栏），blur 输入框保持视觉一致；
  // 搜索栏仍然挂载可见，仅键盘归属移交终端。
  useEffect(() => {
    if (visible && activeOverlayId !== searchId) {
      inputRef.current?.blur();
    }
  }, [visible, activeOverlayId, searchId]);

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

  const endSearch = useCallback(() => {
    window.pier.terminal
      .endSearch(panelId)
      .catch((err: unknown) => reportSearchError("end", err));
  }, [panelId]);

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

  const close = useCallback(() => {
    setQuery("");
    setSearchState(EMPTY_SEARCH_STATE);
    endSearch();
    useTerminalStore.getState().deactivateOverlay(searchId);
    onClose();
  }, [endSearch, onClose, searchId]);

  // Panel 内任意处 Esc 关闭：web 焦点走 window keydown；终端占 FR 时走
  // native shortcut forward（打开期间临时允许 Escape）。
  useEffect(() => {
    if (!visible) {
      return;
    }
    const releaseEscapeShortcut = acquireTerminalEscapeShortcut();

    const shouldHandleEscape = (target: EventTarget | null): boolean => {
      if (activeTerminalPanelId() !== panelId) {
        return false;
      }
      // Dialog / 命令面板等阻断层优先。
      if (useKeybindingScope.getState().overlayStack.length > 0) {
        return false;
      }
      const el = target instanceof Element ? target : null;
      // Rich Input 自己的 Esc 关闭路径优先。
      if (el?.closest?.('[data-testid="terminal-composer"]')) {
        return false;
      }
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (!shouldHandleEscape(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    const unsubscribeForward = window.pier?.keybinding?.onForward?.(
      ({ modifierFlags, chars }) => {
        if (!isBareEscapeForward(modifierFlags, chars)) {
          return;
        }
        if (!shouldHandleEscape(null)) {
          return;
        }
        close();
      }
    );

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribeForward?.();
      releaseEscapeShortcut();
    };
  }, [close, panelId, visible]);

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
      className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-background/40 shadow-lg"
      data-terminal-search-bar=""
      data-testid="terminal-search-bar"
    >
      <InputGroup className="w-52 min-w-0">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={t("terminal.search.placeholder")}
          data-testid="terminal-search-input"
          onChange={(event) => runSearch(event.currentTarget.value)}
          onFocus={() => useTerminalStore.getState().activateOverlay(searchId)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              navigate(event.shiftKey ? "previous" : "next");
            }
            // Escape：由 panel 级 capture 监听统一关闭，避免双路径。
          }}
          placeholder={t("terminal.search.placeholder")}
          ref={inputRef}
          type="text"
          value={query}
        />
      </InputGroup>
      {query ? (
        <Badge
          className="tabular-nums"
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
        <ArrowUp data-icon="inline-start" />
      </Button>
      <Button
        aria-label={t("terminal.search.next")}
        className="shrink-0"
        onClick={() => navigate("next")}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ArrowDown data-icon="inline-start" />
      </Button>
      <Button
        aria-label={t("terminal.search.close")}
        className="shrink-0"
        onClick={close}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X data-icon="inline-start" />
      </Button>
    </search>
  );
}
