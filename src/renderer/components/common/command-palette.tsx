/**
 * 命令面板 UI:
 *   - state machine 由 controller 管, 这里只渲染 + 路由用户事件回 controller。
 *   - capture-phase keydown 拦 Esc → controller.goBack() (栈非空回退, 栈空关闭),
 *     早于 Radix DismissibleLayer 的 Esc 默认行为。
 *   - 关闭时若 quick-pick 未 accept, dismiss effect 调 onDismiss 还原 preview。
 *   - selectedValue 控制高亮项, 切 quick-pick 时初始化为 checked item, 触发
 *     debounced onChangeSelection (preview 去重)。
 */
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CommandsView,
  SearchResultsView,
} from "@/components/common/command-palette-action-rows.tsx";
import { Badge } from "@/components/primitives/badge.tsx";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/primitives/command.tsx";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import {
  groupActionsForPalette as groupActionsForPaletteImpl,
  rankActionsForPalette as rankActionsForPaletteImpl,
} from "@/lib/command-palette/action-search.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { CATEGORY_META } from "@/lib/command-palette/frecency.ts";
import type { QuickPick, QuickPickItem } from "@/lib/command-palette/types.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { popOverlay, pushOverlay } from "@/stores/terminal-overlay.store.ts";

function useActions(): readonly Action[] {
  // version 变 → snapshot 变 → useSyncExternalStore 通知 React 重渲,
  // 重渲时 list() 取到最新数组。React Compiler 自动按 version 依赖 memo。
  useSyncExternalStore(
    (cb) => actionRegistry.subscribe(cb),
    () => actionRegistry.getVersion(),
    () => 0
  );
  return actionRegistry.list("command-palette");
}

function quickPickItems(quickPick: QuickPick): readonly QuickPickItem[] {
  if (quickPick.sections && quickPick.sections.length > 0) {
    return quickPick.sections.flatMap((section) => section.items);
  }
  return quickPick.items ?? [];
}

/**
 * 反查每个 actionId 当前生效的 keybinding 文案. 订阅两个 registry 的 version
 * 触发重渲, 重渲时拉两边最新数据 build map. React Compiler 自动按 version
 * 依赖 memo, 避免每 render churn map 引用。
 */
function useKeybindingLabels(): ReadonlyMap<string, string> {
  useSyncExternalStore(
    (cb) => actionRegistry.subscribe(cb),
    () => actionRegistry.getVersion(),
    () => 0
  );
  useSyncExternalStore(
    (cb) => keybindingRegistry.subscribe(cb),
    () => keybindingRegistry.getVersion(),
    () => 0
  );
  const map = new Map<string, string>();
  for (const action of actionRegistry.list("command-palette")) {
    const first = keybindingRegistry.getBindingsFor(action.id)[0];
    if (first) {
      map.set(action.id, formatChord(first.chord));
    }
  }
  return map;
}

export function CommandPalette() {
  const t = useT();
  const controller = useCommandPaletteController();
  const actions = useActions();
  const keybindingLabels = useKeybindingLabels();
  const frecencyMap = useCommandPaletteMru((s) => s.frecencyMap);

  // 本地 UI 态: 与 controller 保持同步, 但 cmdk 需要 controlled value/query 引用稳定。
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const groups =
    normalizedQuery.length === 0
      ? groupActionsForPaletteImpl(actions, frecencyMap, normalizedQuery)
      : [];
  const rankedActions =
    normalizedQuery.length > 0
      ? rankActionsForPaletteImpl(
          actions,
          frecencyMap,
          normalizedQuery,
          keybindingLabels
        )
      : [];
  const [selectedValue, setSelectedValue] = useState("");
  const lastRequestIdRef = useRef(-1);
  // null = 未 accept; 非 null = 已 accept (值是 item id)。
  // 关闭瞬间 dismiss effect 用它判断是否需调 onDismiss。
  const acceptedItemIdRef = useRef<string | null>(null);

  const mode = controller.mode;
  const quickPick = controller.quickPick;
  const isOpen = controller.open;
  const requestId = controller.requestId;

  // 通知 native 层 overlay 打开/关闭, 以便暂停终端事件路由;
  // 同时 push scope id 进 keybinding scope 栈, 让 overlay 期间 panel/global
  // scope 被阻断 (spec user Q1 选项 B: overlay 内未注册的快捷键不 fall through)。
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    pushOverlay();
    useKeybindingScope.getState().pushOverlay("overlay:command-palette");
    return () => {
      useKeybindingScope.getState().popOverlay("overlay:command-palette");
      popOverlay();
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
    setQuery("");
    acceptedItemIdRef.current = null;
    if (mode === "quick-pick" && quickPick) {
      const items = quickPickItems(quickPick);
      const checked =
        items.find((i) => i.checked && !i.disabled) ??
        items.find((i) => !i.disabled);
      setSelectedValue(checked?.id ?? "");
    } else {
      setSelectedValue("");
    }
  }, [isOpen, requestId, mode, quickPick]);

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
    const item = quickPickItems(quickPick).find((i) => i.id === next);
    if (!item || item.disabled) {
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

  useEffect(() => {
    if (mode !== "commands" || normalizedQuery.length === 0) {
      return;
    }
    if (rankedActions.some((action) => action.id === selectedValue)) {
      return;
    }
    setSelectedValue(rankedActions[0]?.id ?? "");
  }, [mode, normalizedQuery, rankedActions, selectedValue]);

  const handleAcceptQuickPickItem = async (item: QuickPickItem) => {
    if (item.disabled || !quickPick) {
      return;
    }
    const before = useCommandPaletteController.getState().requestId;
    acceptedItemIdRef.current = item.id;
    try {
      await quickPick.onAccept(item);
      // 若 onAccept 没开新一轮 (requestId 未变) 且面板仍开着, 收尾关掉。
      const after = useCommandPaletteController.getState();
      if (after.requestId === before && after.open) {
        useCommandPaletteController.getState().close();
      }
    } catch (err) {
      // accept 失败: 复位 flag 让 Esc 仍能触发 onDismiss; err 上报便于排查 (不静默).
      acceptedItemIdRef.current = null;
      console.error("[command-palette] onAccept threw:", err);
    }
  };

  const handleExecuteAction = async (action: Action) => {
    if (action.enabled?.() === false) {
      return;
    }
    const before = useCommandPaletteController.getState().requestId;
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
    mode === "quick-pick" && quickPick
      ? quickPick.title
      : t("commandPalette.title");
  const dialogPlaceholder =
    mode === "quick-pick" && quickPick
      ? (quickPick.placeholder ?? quickPick.title)
      : t("commandPalette.placeholder.commands");
  const commandContent: ReactNode =
    mode === "quick-pick" && quickPick ? (
      <QuickPickView
        onAccept={handleAcceptQuickPickItem}
        query={normalizedQuery}
        quickPick={quickPick}
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
        onValueChange={handleValueChange}
        shouldFilter={false}
        value={selectedValue}
      >
        <CommandInput
          onValueChange={setQuery}
          placeholder={dialogPlaceholder}
          value={query}
        />
        <CommandList className="max-h-[min(60vh,520px)]">
          <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
          {commandContent ?? actionContent}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function QuickPickView({
  quickPick,
  onAccept,
  query,
}: {
  quickPick: QuickPick;
  onAccept: (item: QuickPickItem) => Promise<void>;
  query: string;
}): ReactNode {
  const filterItem = (item: QuickPickItem) => quickPickItemMatches(item, query);
  const renderItem = (item: QuickPickItem) => (
    <CommandItem
      aria-current={item.checked === true ? "true" : undefined}
      data-checked={item.checked === true}
      data-disabled={item.disabled === true}
      disabled={item.disabled === true}
      key={item.id}
      onSelect={() => {
        onAccept(item).catch((err) => {
          console.error(
            `[command-palette] quick-pick onAccept ${item.id} rejected:`,
            err
          );
        });
      }}
      value={item.id}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{item.label}</span>
          {item.badges?.map((badge) => (
            <Badge
              className="h-4.5 px-1.5 text-[10px]"
              key={`${item.id}:${badge.label}`}
              variant={badge.variant ?? "secondary"}
            >
              {badge.label}
            </Badge>
          ))}
        </span>
        {item.detail ? (
          <span className="block truncate text-muted-foreground text-xs">
            {item.detail}
          </span>
        ) : null}
      </span>
      {item.description ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          {item.description}
        </span>
      ) : null}
    </CommandItem>
  );

  return (
    <div className="mt-2">
      {quickPick.sections && quickPick.sections.length > 0
        ? quickPick.sections.map((section) => (
            <CommandGroup heading={section.heading} key={section.id}>
              {section.items.filter(filterItem).map(renderItem)}
            </CommandGroup>
          ))
        : (quickPick.items ?? []).filter(filterItem).map(renderItem)}
    </div>
  );
}

function quickPickItemMatches(item: QuickPickItem, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [
    item.id,
    item.label,
    item.detail ?? "",
    item.description ?? "",
    ...(item.keywords ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}
