/**
 * 命令面板 UI:
 *   - state machine 由 controller 管, 这里只渲染 + 路由用户事件回 controller。
 *   - capture-phase keydown 拦 Esc → controller.goBack() (栈非空回退, 栈空关闭),
 *     早于 Radix DismissibleLayer 的 Esc 默认行为。
 *   - 关闭时若 quick-pick 未 accept, dismiss effect 调 onDismiss 还原 preview。
 *   - selectedValue 控制高亮项, 切 quick-pick 时初始化为 checked item, 触发
 *     debounced onChangeSelection (preview 去重)。
 */
import { Settings } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/primitives/command.tsx";
import { Kbd } from "@/components/primitives/kbd.tsx";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type { QuickPick, QuickPickItem } from "@/lib/command-palette/types.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";

interface CategoryMeta {
  /** 用作 i18n key: commandPalette.category.${labelKey} */
  labelKey: string;
  order: number;
}

// 新增分类时这里加一行 + i18n 加 commandPalette.category.<key>。未注册的分类
// 兜底排在末尾, label 直接用 raw category 字符串。
const CATEGORY_META: Record<string, CategoryMeta> = {
  View: { order: 0, labelKey: "view" },
  Settings: { order: 1, labelKey: "settings" },
};

const UNKNOWN_ORDER = Object.keys(CATEGORY_META).length;

function categoryRank(category: string): number {
  return CATEGORY_META[category]?.order ?? UNKNOWN_ORDER;
}

interface ActionGroup {
  actions: Action[];
  category: string;
}

function groupActions(actions: readonly Action[]): ActionGroup[] {
  const map = new Map<string, Action[]>();
  for (const action of actions) {
    const list = map.get(action.category) ?? [];
    list.push(action);
    map.set(action.category, list);
  }
  return Array.from(map.entries())
    .map(([category, list]) => ({ category, actions: list }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
}

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
  const groups = groupActions(actions);
  const keybindingLabels = useKeybindingLabels();

  // 本地 UI 态: 与 controller 保持同步, 但 cmdk 需要 controlled value/query 引用稳定。
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const lastRequestIdRef = useRef(-1);
  // null = 未 accept; 非 null = 已 accept (值是 item id)。
  // 关闭瞬间 dismiss effect 用它判断是否需调 onDismiss。
  const acceptedItemIdRef = useRef<string | null>(null);

  const mode = controller.mode;
  const quickPick = controller.quickPick;
  const isOpen = controller.open;
  const requestId = controller.requestId;

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
      const checked =
        quickPick.items.find((i) => i.checked && !i.disabled) ??
        quickPick.items.find((i) => !i.disabled);
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
    const item = quickPick.items.find((i) => i.id === next);
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

  return (
    <CommandDialog
      className="top-[14vh] sm:max-w-[520px]"
      description={dialogTitle}
      onOpenChange={handleOpenChange}
      open={isOpen}
      title={dialogTitle}
    >
      <Command
        loop
        onKeyDown={handleCommandKeyDown}
        onValueChange={handleValueChange}
        value={selectedValue}
      >
        <CommandInput
          onValueChange={setQuery}
          placeholder={dialogPlaceholder}
          value={query}
        />
        <CommandList className="max-h-[min(60vh,520px)]">
          <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
          {mode === "quick-pick" && quickPick ? (
            <QuickPickView
              onAccept={handleAcceptQuickPickItem}
              quickPick={quickPick}
            />
          ) : (
            <CommandsView
              groups={groups}
              keybindingLabels={keybindingLabels}
              onExecute={handleExecuteAction}
              t={t}
            />
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function CommandsView({
  groups,
  keybindingLabels,
  onExecute,
  t,
}: {
  groups: readonly ActionGroup[];
  keybindingLabels: ReadonlyMap<string, string>;
  onExecute: (action: Action) => Promise<void>;
  t: ReturnType<typeof useT>;
}): ReactNode {
  return (
    <>
      {groups.map((group) => {
        const meta = CATEGORY_META[group.category];
        const heading = meta
          ? t(`commandPalette.category.${meta.labelKey}`)
          : group.category;
        return (
          <CommandGroup heading={heading} key={group.category}>
            {group.actions.map((action) => {
              const Icon = action.metadata?.iconComponent ?? Settings;
              const shortcut = keybindingLabels.get(action.id);
              return (
                <CommandItem
                  data-disabled={action.enabled?.() === false}
                  key={action.id}
                  keywords={[
                    action.title(),
                    ...(action.metadata?.keywords ?? []),
                  ]}
                  onSelect={() => {
                    onExecute(action).catch((err) => {
                      console.error(
                        `[command-palette] onSelect ${action.id} rejected:`,
                        err
                      );
                    });
                  }}
                  value={action.id}
                >
                  <Icon className="size-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">
                    {action.title()}
                  </span>
                  {shortcut ? (
                    <Kbd className="ml-auto bg-transparent font-mono tracking-wider">
                      {shortcut}
                    </Kbd>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        );
      })}
    </>
  );
}

function QuickPickView({
  quickPick,
  onAccept,
}: {
  quickPick: QuickPick;
  onAccept: (item: QuickPickItem) => Promise<void>;
}): ReactNode {
  // 不包 CommandGroup heading: dialog 输入框 placeholder 已说明当前在选什么
  // (e.g. "选择主题 (↑↓ 预览, ↵ 确认, Esc 还原)"), 再加一行分组标题是冗余。
  // quick-pick items 平铺在 CommandList 下。
  return (
    <div className="mt-2">
      {quickPick.items.map((item) => (
        <CommandItem
          data-checked={item.checked === true}
          data-disabled={item.disabled === true}
          key={item.id}
          keywords={[item.label, item.id, ...(item.keywords ?? [])]}
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
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.description ? (
            <span className="shrink-0 text-muted-foreground text-xs">
              {item.description}
            </span>
          ) : null}
        </CommandItem>
      ))}
    </div>
  );
}
