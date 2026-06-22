/**
 * 命令面板 UI:
 *   - state machine 由 controller 管, 这里只渲染 + 路由用户事件回 controller。
 *   - capture-phase keydown 拦 Esc → controller.goBack() (栈非空回退, 栈空关闭),
 *     早于 cmdk Dialog 的 Esc 默认行为。
 *   - 关闭时若 quick-pick 未 accept, dismiss effect 调 onDismiss 还原 preview。
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
  labelKey: string;
  order: number;
}

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
  useSyncExternalStore(
    (cb) => actionRegistry.subscribe(cb),
    () => actionRegistry.getVersion(),
    () => 0
  );
  return actionRegistry.list("command-palette");
}

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

  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const lastRequestIdRef = useRef(-1);
  const acceptedItemIdRef = useRef<string | null>(null);

  const mode = controller.mode;
  const quickPick = controller.quickPick;
  const isOpen = controller.open;
  const requestId = controller.requestId;

  // 新一轮 session: 重置 query / selectedValue / accepted flag。
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

  // 关闭时, 若 quick-pick 未 accept 调 onDismiss。
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
    lastRequestIdRef.current = -1;
  }, [isOpen, mode, quickPick]);

  // capture-phase Esc → goBack。
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

  // Backspace 在空 query + quick-pick 模式时回退一层。
  const handleCommandKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Backspace" && !query && controller.mode === "quick-pick") {
      e.preventDefault();
      e.stopPropagation();
      useCommandPaletteController.getState().goBack();
    }
  };

  // 箭头键 / hover 高亮变化 → preview。
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
      const after = useCommandPaletteController.getState();
      if (after.requestId === before && after.open) {
        useCommandPaletteController.getState().close();
      }
    } catch (err) {
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
        <CommandList>
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
