/** 命令面板 UI：controller 管状态；组件负责渲染并路由关闭、回退和选择事件。 */

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@pier/ui/command.tsx";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CommandsView,
  SearchResultsView,
} from "@/components/common/command-palette-action-rows.tsx";
import {
  isQuickPickItemSelectable,
  QuickPickView,
  quickPickItems,
  quickPickPresentedItems,
  quickPickQueryItem,
} from "@/components/common/command-palette-quick-pick-view.tsx";
import { useT } from "@/i18n/use-t.ts";
import type { Action } from "@/lib/actions/types.ts";
import {
  groupActionsForPalette as groupActionsForPaletteImpl,
  rankActionsForPalette as rankActionsForPaletteImpl,
} from "@/lib/command-palette/action-search.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { CATEGORY_META } from "@/lib/command-palette/frecency.ts";
import type { QuickPickItem } from "@/lib/command-palette/types.ts";
import { useCommandPaletteCommandsSelection } from "@/lib/command-palette/use-command-palette-commands-selection.ts";
import {
  useCommandPaletteActions,
  useCommandPaletteKeybindingLabels,
} from "@/lib/command-palette/use-command-palette-data.ts";
import { useCommandPaletteScroll } from "@/lib/command-palette/use-command-palette-scroll.ts";
import { useCommandPointerSelectionGate } from "@/lib/command-palette/use-command-pointer-selection-gate.ts";
import { useQuickPickQueryChange } from "@/lib/command-palette/use-quick-pick-query-change.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";

export function CommandPalette() {
  const t = useT();
  const controller = useCommandPaletteController();
  const actions = useCommandPaletteActions();
  const keybindingLabels = useCommandPaletteKeybindingLabels();
  const frecencyMap = useCommandPaletteMru((s) => s.frecencyMap);

  // 本地 UI 态: 与 controller 保持同步, 但 cmdk 需要 controlled value/query 引用稳定。
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const groups = useMemo(
    () =>
      normalizedQuery.length === 0
        ? groupActionsForPaletteImpl(actions, frecencyMap, normalizedQuery)
        : [],
    [actions, frecencyMap, normalizedQuery]
  );
  const rankedActions = useMemo(
    () =>
      normalizedQuery.length > 0
        ? rankActionsForPaletteImpl(
            actions,
            frecencyMap,
            normalizedQuery,
            keybindingLabels
          )
        : [],
    [actions, frecencyMap, keybindingLabels, normalizedQuery]
  );
  const [selectedValue, setSelectedValue] = useState("");
  const lastRequestIdRef = useRef(-1);
  // null = 未 accept; 非 null = 已 accept (值是 item id)。
  // 关闭瞬间 dismiss effect 用它判断是否需调 onDismiss。
  const acceptedItemIdRef = useRef<string | null>(null);

  const mode = controller.mode;
  const quickPick = controller.quickPick;
  const isOpen = controller.open;
  const requestId = controller.requestId;
  const listRef = useCommandPaletteScroll({
    isOpen,
    query: normalizedQuery,
    requestId,
    selectedValue,
  });
  const pointerSelectionGate = useCommandPointerSelectionGate(
    `${isOpen}:${requestId}:${normalizedQuery}:${mode}`
  );
  const [retainedPresentation, setRetainedPresentation] = useState({
    mode,
    quickPick,
  });

  useLayoutEffect(() => {
    if (isOpen) {
      setRetainedPresentation({ mode, quickPick });
    }
  }, [isOpen, mode, quickPick]);

  const presentedMode = isOpen ? mode : retainedPresentation.mode;
  const presentedQuickPick = isOpen
    ? quickPick
    : retainedPresentation.quickPick;

  // 键盘打开时显式请求 Web 焦点；Dialog overlay 的鼠标命中几何由 @pier/ui
  // 默认注册。同时 push scope id 进 keybinding scope 栈, 让浮层期间 panel/global
  // scope 被阻断 (spec user Q1 选项 B: overlay 内未注册的快捷键不 fall through)。
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const releaseWebFocus = requestTerminalWebFocus("command-palette");
    useKeybindingScope.getState().pushBlockingScope("overlay:command-palette");
    return () => {
      useKeybindingScope.getState().popBlockingScope("overlay:command-palette");
      releaseWebFocus();
    };
  }, [isOpen]);

  // 新一轮 session (open 或 openQuickPick): 重置 query / selectedValue / accepted flag。
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (requestId === lastRequestIdRef.current) {
      return;
    }
    lastRequestIdRef.current = requestId;
    setQuery(
      mode === "quick-pick" && quickPick ? (quickPick.initialQuery ?? "") : ""
    );
    acceptedItemIdRef.current = null;
    if (mode === "quick-pick" && quickPick) {
      const items = quickPickItems(quickPick);
      const checked =
        items.find(
          (i) => i.checked && isQuickPickItemSelectable(quickPick, i)
        ) ?? items.find((i) => isQuickPickItemSelectable(quickPick, i));
      setSelectedValue(checked?.id ?? "");
    } else {
      setSelectedValue("");
    }
  }, [isOpen, requestId, mode, quickPick]);

  // replaceQuickPick 保留 requestId/query；同一 session 换内容时只修正选中项。
  useEffect(() => {
    if (!isOpen || mode !== "quick-pick" || !quickPick) {
      return;
    }
    if (requestId !== lastRequestIdRef.current) {
      return;
    }
    const items = quickPickPresentedItems(quickPick, normalizedQuery);
    const selected = items.find((item) => item.id === selectedValue);
    const queryItem = quickPickQueryItem(quickPick, normalizedQuery);
    if (
      selected &&
      (selected.id === queryItem?.id ||
        isQuickPickItemSelectable(quickPick, selected))
    ) {
      return;
    }
    const next =
      items.find(
        (item) => item.checked && isQuickPickItemSelectable(quickPick, item)
      ) ?? items.find((item) => isQuickPickItemSelectable(quickPick, item));
    setSelectedValue(next?.id ?? "");
  }, [isOpen, mode, normalizedQuery, quickPick, requestId, selectedValue]);

  // 仅用户输入变化时把高亮重置到第一项；updateQuickPick 换 items 不得抢键盘选中。
  const lastQueryForSelectionRef = useRef(normalizedQuery);
  useEffect(() => {
    if (!isOpen || mode !== "quick-pick" || !quickPick) {
      return;
    }
    if (lastQueryForSelectionRef.current === normalizedQuery) {
      return;
    }
    lastQueryForSelectionRef.current = normalizedQuery;
    const queryItem = quickPickQueryItem(quickPick, normalizedQuery);
    if (queryItem) {
      setSelectedValue(queryItem.id);
      return;
    }
    const items = quickPickPresentedItems(quickPick, normalizedQuery);
    const next =
      items.find(
        (item) => item.checked && isQuickPickItemSelectable(quickPick, item)
      ) ?? items.find((item) => isQuickPickItemSelectable(quickPick, item));
    setSelectedValue(next?.id ?? "");
  }, [isOpen, mode, normalizedQuery, quickPick]);

  useQuickPickQueryChange({
    handler: quickPick?.onQueryChange,
    isOpen,
    mode,
    query: normalizedQuery,
    requestId,
  });

  // 关闭 (Esc 已走 goBack 路径或点击遮罩) 时, 若 quick-pick 未 accept 调 onDismiss。
  // goBack() 内联调过 onDismiss, 但 close() 路径 (点击遮罩) 没调, 这里补。
  // mode/quickPick 在 close() 后仍保留, 故能读到。
  useEffect(() => {
    if (isOpen) {
      return;
    }
    if (
      mode === "quick-pick" &&
      quickPick?.onDismiss &&
      acceptedItemIdRef.current === null
    ) {
      quickPick.onDismiss();
    }
    // 关闭后清 lastRequestId, 下次开重新初始化。
    lastRequestIdRef.current = -1;
  }, [isOpen, mode, quickPick]);

  // capture-phase Esc → goBack。早于 Radix DismissibleLayer 的 Esc, 阻止其
  // 把 dialog 直接关掉; 栈非空回退到上层, 栈空才关。
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      useCommandPaletteController.getState().goBack();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isOpen]);

  // Backspace 在空 query + quick-pick 模式时回退一层 (VS Code 行为)。
  const handleCommandKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      quickPick?.onAcceptQuery
    ) {
      e.preventDefault();
      e.stopPropagation();
      const before = useCommandPaletteController.getState().requestId;
      acceptedItemIdRef.current = `query:${before}`;
      const onAcceptQuery = quickPick.onAcceptQuery;
      const accepted = Promise.resolve().then(() => onAcceptQuery(query));
      const afterAccept = useCommandPaletteController.getState();
      if (afterAccept.requestId === before && afterAccept.open) {
        afterAccept.closeAfterAccept();
      }
      accepted
        .catch((error: unknown) => {
          acceptedItemIdRef.current = null;
          console.error("[command-palette] onAcceptQuery threw:", error);
          showAppAlert({
            body: error instanceof Error ? error.message : String(error),
            title: t("commandPalette.inputFailed"),
          }).catch((alertError: unknown) => {
            console.error("[command-palette] input alert failed:", alertError);
          });
        })
        .finally(() => {
          useCommandPaletteController
            .getState()
            .schedulePendingAcceptStackClear();
        });
      return;
    }
    if (e.key === "Backspace" && !query && controller.mode === "quick-pick") {
      e.preventDefault();
      e.stopPropagation();
      useCommandPaletteController.getState().goBack();
    }
  };

  // 箭头键 / hover 高亮变化 → preview。在 quick-pick 模式且 onChangeSelection 存在时触发。
  const handleValueChange = (next: string) => {
    setSelectedValue(next);
    if (mode !== "quick-pick" || !quickPick?.onChangeSelection) {
      return;
    }
    const item = quickPickPresentedItems(quickPick, normalizedQuery).find(
      (i) => i.id === next
    );
    if (!(item && isQuickPickItemSelectable(quickPick, item))) {
      return;
    }
    quickPick.onChangeSelection(item);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Esc 已 stopImmediatePropagation, 不会走到这。这里只剩点击遮罩。
      useCommandPaletteController.getState().close();
    }
  };

  useCommandPaletteCommandsSelection({
    groups,
    mode,
    normalizedQuery,
    rankedActions,
    selectedValue,
    setSelectedValue,
  });

  const handleAcceptQuickPickItem = async (item: QuickPickItem) => {
    if (!(quickPick && isQuickPickItemSelectable(quickPick, item))) {
      return;
    }
    const before = useCommandPaletteController.getState().requestId;
    acceptedItemIdRef.current = item.id;
    try {
      const accepted = quickPick.onAccept(item);
      // 先视觉关闭当前 picker；若 accept 稍后再开 picker，controller 会保留回退栈。
      const afterAccept = useCommandPaletteController.getState();
      if (afterAccept.requestId === before && afterAccept.open) {
        afterAccept.closeAfterAccept();
      }
      await accepted;
    } catch (err) {
      acceptedItemIdRef.current = null;
      console.error("[command-palette] onAccept threw:", err);
    } finally {
      useCommandPaletteController.getState().schedulePendingAcceptStackClear();
    }
  };

  const handleExecuteAction = async (action: Action) => {
    if (action.enabled?.() === false) {
      return;
    }
    const controller = useCommandPaletteController.getState();
    const before = controller.requestId;
    try {
      await action.handler();
      if (!action.metadata?.excludeFromMru) {
        useCommandPaletteMru.getState().recordUse(action.id);
      }
      const after = useCommandPaletteController.getState();
      // handler 没开 quick-pick (requestId 没变) 且仍在 commands 模式: 关闭面板。
      if (after.requestId === before && after.mode === "commands") {
        useCommandPaletteController.getState().close();
      }
    } catch (err) {
      console.error(`[command-palette] action ${action.id} threw:`, err);
    }
  };

  const dialogTitle =
    presentedMode === "quick-pick" && presentedQuickPick
      ? presentedQuickPick.title
      : t("commandPalette.title");
  const dialogPlaceholder =
    presentedMode === "quick-pick" && presentedQuickPick
      ? (presentedQuickPick.placeholder ?? presentedQuickPick.title)
      : t("commandPalette.placeholder.commands");
  const commandContent: ReactNode =
    presentedMode === "quick-pick" && presentedQuickPick ? (
      <QuickPickView
        onAccept={handleAcceptQuickPickItem}
        query={normalizedQuery}
        quickPick={presentedQuickPick}
      />
    ) : null;
  const actionContent: ReactNode =
    normalizedQuery.length > 0 ? (
      <SearchResultsView
        actions={rankedActions}
        heading={t("commandPalette.searchResults")}
        keybindingLabels={keybindingLabels}
        onExecute={handleExecuteAction}
      />
    ) : (
      <CommandsView
        categoryHeading={(category) => {
          const meta = CATEGORY_META[category];
          return meta
            ? t(`commandPalette.category.${meta.labelKey}`)
            : category;
        }}
        groups={groups}
        keybindingLabels={keybindingLabels}
        onExecute={handleExecuteAction}
      />
    );

  return (
    <CommandDialog
      className="top-[14vh] sm:max-w-130"
      description={dialogTitle}
      onOpenChange={handleOpenChange}
      open={isOpen}
      title={dialogTitle}
    >
      <Command
        loop
        onKeyDown={handleCommandKeyDown}
        onPointerMoveCapture={pointerSelectionGate.onPointerMoveCapture}
        onValueChange={handleValueChange}
        shouldFilter={false}
        value={selectedValue}
      >
        <CommandInput
          onValueChange={setQuery}
          placeholder={dialogPlaceholder}
          value={query}
        />
        {presentedMode === "quick-pick" && presentedQuickPick?.errorText ? (
          <div
            className="border-b px-3 py-2 text-destructive text-xs"
            role="alert"
          >
            {presentedQuickPick.errorText}
          </div>
        ) : null}
        {quickPick?.onAcceptQuery ? null : (
          <CommandList className="max-h-[min(60vh,520px)]" ref={listRef}>
            <CommandEmpty>
              {presentedMode === "quick-pick"
                ? t("commandPalette.emptyQuickPick")
                : t("commandPalette.empty")}
            </CommandEmpty>
            {commandContent ?? actionContent}
          </CommandList>
        )}
      </Command>
    </CommandDialog>
  );
}
