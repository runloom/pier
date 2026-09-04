/**
 * Tab 栏 add 按钮 — 同源锚定创建器.
 *
 * 数据源: actionRegistry.list("create-menu"), 与命令面板共享同一套
 * action 注册、搜索算法和行渲染. 空态不按 frecency 整组提前.
 *
 * 与 Cmd+Shift+P 的唯一区别:
 *   - 位置: 锚定在 "+" 按钮旁, 而非屏幕中央
 *   - 范围: 只显示 create-menu surface 的动作
 *   - 上下文: 执行时传 sourcePanelGroupId, 让新标签落到被点击的 group
 *
 * 打开时后台触发 agent 检测; 检测失败只影响智能体行, 不关闭整个创建器.
 */

import { Button } from "@pier/ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@pier/ui/command.tsx";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@pier/ui/popover.tsx";
import {
  releaseTooltipSuppression,
  suppressTooltips,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActionCommandItem,
  CommandsView,
} from "@/components/common/command-palette/action-rows.tsx";
import { useT } from "@/i18n/use-t.ts";
import {
  actionRegistry,
  getActionRegistryVersion,
  subscribeActionRegistry,
} from "@/lib/actions/registry.ts";
import { resolveActionShortcutChord } from "@/lib/actions/shortcut-hint.ts";
import type { Action, ActionInvocation } from "@/lib/actions/types.ts";
import { rankActionsForPalette } from "@/lib/command-palette/action-search.ts";
import {
  CREATE_MENU_CATEGORY_ORDER,
  commandListCategoryLabel,
  compareCreateMenuItems,
  presentCommandListGroups,
  WORKSPACE_PRESENTATION_ID,
} from "@/lib/command-palette/present-groups.ts";
import { useCommandPointerSelectionGate } from "@/lib/command-palette/use-command-pointer-selection-gate.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import {
  getKeybindingRegistryVersion,
  subscribeKeybindingRegistry,
} from "@/lib/keybindings/registry.ts";
import { useActionKeybindingLabel } from "@/lib/keybindings/use-action-label.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
import {
  consumeWebOverlayOutsideDismiss,
  markWebOverlayOutsideDismissIfNeeded,
  restoreTerminalFocusAfterWebOverlayDismiss,
} from "@/lib/workspace/restore-terminal-focus-after-web-overlay-dismiss.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";
import { useCreateMenuRequestStore } from "@/stores/create-menu-request.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";
import { CreateMenuManageAgents } from "./create-menu-manage-agents.tsx";

const CREATE_MENU_SCOPE = "overlay:add-panel";
const IME_PENDING_KEYCODE = 229;

function useKeybindingLabels(
  actions: readonly Action[]
): ReadonlyMap<string, string> {
  const keybindingVersion = useSyncExternalStore(
    subscribeKeybindingRegistry,
    getKeybindingRegistryVersion,
    () => 0
  );
  return useMemo(
    () =>
      readVersionedSnapshot(keybindingVersion, () => {
        const map = new Map<string, string>();
        for (const action of actions) {
          const chord = resolveActionShortcutChord(action);
          if (chord) {
            map.set(action.id, formatChord(chord));
          }
        }
        return map;
      }),
    [actions, keybindingVersion]
  );
}

export function AddPanelAction(props: IDockviewHeaderActionsProps) {
  const t = useT();
  const createShortcut = useActionKeybindingLabel("pier.panel.openCreateMenu");
  // Contextual action thunks use getState(); this subscription keeps their
  // enabled state and disabled reason current while the creator stays open.
  usePanelDescriptorStore((state) =>
    props.activePanel ? state.descriptors[props.activePanel.id] : undefined
  );
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const invocationRef = useRef<ActionInvocation | null>(null);
  const sourcePanelId = props.activePanel?.id;
  const sourcePanelGroupId = props.group?.id;
  const consumedRequestIdRef = useRef(0);
  const createMenuRequestId = useCreateMenuRequestStore((s) => s.requestId);
  const createMenuTargetGroupId = useCreateMenuRequestStore(
    (s) => s.targetGroupId
  );

  // pier.panel.openCreateMenu (默认 Cmd+N) 把 targetGroupId 写进 store,
  // 各 group 的 AddPanelAction 自查 id 匹配则打开本地 Popover。
  useEffect(() => {
    if (
      createMenuRequestId === consumedRequestIdRef.current ||
      !sourcePanelGroupId ||
      createMenuTargetGroupId !== sourcePanelGroupId
    ) {
      return;
    }
    consumedRequestIdRef.current = createMenuRequestId;
    useCreateMenuRequestStore.getState().markConsumed(createMenuRequestId);
    setOpen(true);
  }, [createMenuRequestId, createMenuTargetGroupId, sourcePanelGroupId]);

  const sourceActionInvocation = useCallback((): ActionInvocation => {
    const sourcePanelContext = sourcePanelId
      ? usePanelDescriptorStore.getState().descriptors[sourcePanelId]?.context
      : undefined;
    return {
      ...(sourcePanelContext ? { sourcePanelContext } : {}),
      ...(sourcePanelGroupId ? { sourcePanelGroupId } : {}),
      ...(sourcePanelId ? { sourcePanelId } : {}),
      surface: "create-menu",
    };
  }, [sourcePanelGroupId, sourcePanelId]);

  // Subscribe to registry/mru version changes for re-render.
  const actionVersion = useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    () => 0
  );
  const frecencyMap = useCommandPaletteMru((s) => s.frecencyMap);

  const allCreateActions = useMemo(
    () =>
      readVersionedSnapshot(actionVersion, () =>
        actionRegistry.list("create-menu")
      ),
    [actionVersion]
  );
  const keybindingLabels = useKeybindingLabels(allCreateActions);
  const normalizedQuery = query.trim();
  const groups = useMemo(
    () =>
      normalizedQuery.length === 0
        ? presentCommandListGroups(allCreateActions, {
            categoryLabel: (category) =>
              commandListCategoryLabel(category, (key) => t(key)),
            categoryOrder: CREATE_MENU_CATEGORY_ORDER,
            foldRemainderInto: WORKSPACE_PRESENTATION_ID,
            itemCompare: compareCreateMenuItems,
            recentLabel: t("commandPalette.recent"),
            recentsLimit: 0,
          })
        : [],
    [allCreateActions, normalizedQuery, t]
  );
  const ranked = useMemo(
    () =>
      normalizedQuery.length > 0
        ? rankActionsForPalette(
            allCreateActions,
            frecencyMap,
            normalizedQuery,
            keybindingLabels
          )
        : [],
    [allCreateActions, frecencyMap, keybindingLabels, normalizedQuery]
  );
  const pointerSelectionGate = useCommandPointerSelectionGate(
    `${open}:${normalizedQuery}`
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    // Activate the clicked panel so worktree/task actions resolve the right context.
    props.activePanel?.api.setActive();
    // Carry the clicked group for action handlers.
    invocationRef.current = sourceActionInvocation();
    // Block global keybindings while the popover is open.
    useKeybindingScope.getState().pushBlockingScope(CREATE_MENU_SCOPE);
    const releaseWebFocus = requestTerminalWebFocus("add-panel");
    // Popover 非 modal, Radix DismissableLayer 靠 document pointerdown 侦测
    // 外部点击。终端是原生 NSView, 点击默认被 native 消费, web 收不到 →
    // 弹层不会关。挂一个全屏 web overlay rect, 让弹层打开期间所有点击 (包括
    // 落在终端 NSView 之上的) 都路由到 web, dismissable-layer 才能触发。
    // 见 app-dialog-host.tsx / app-content-dialog-host.tsx 同款模式。
    const releaseOverlayRoute =
      registerTerminalFullscreenWebOverlay(CREATE_MENU_SCOPE);
    return () => {
      useKeybindingScope.getState().popBlockingScope(CREATE_MENU_SCOPE);
      releaseOverlayRoute.dispose();
      releaseWebFocus();
      invocationRef.current = null;
      // outside（含点终端经全屏 overlay 改道）关闭后补终端聚焦；选动作/Esc 不 mark。
      if (consumeWebOverlayOutsideDismiss(CREATE_MENU_SCOPE)) {
        restoreTerminalFocusAfterWebOverlayDismiss();
      }
    };
  }, [open, props.activePanel, sourceActionInvocation]);

  // executeAction 等路径会旁路 onOpenChange 直接 setOpen(false)；hard suppress 绑 open。
  useEffect(() => {
    if (!open) {
      return;
    }
    suppressTooltips();
    return () => {
      releaseTooltipSuppression();
    };
  }, [open]);

  const executeAction = async (action: Action) => {
    props.activePanel?.api.setActive();
    const invocation = sourceActionInvocation();
    invocationRef.current = invocation;
    if (action.enabled?.(invocation) === false) {
      return;
    }
    setOpen(false);
    setQuery("");
    try {
      await action.handler(invocation);
      if (!action.metadata?.excludeFromMru) {
        useCommandPaletteMru.getState().recordUse(action.id);
      }
    } catch (error) {
      console.error(`[add-panel-action] ${action.id} threw:`, error);
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("workspace.addPanelMenu.actionFailed"),
      });
    }
  };

  const renderListBody = () => {
    if (normalizedQuery.length > 0) {
      if (ranked.length === 0) {
        return (
          <CommandEmpty>{t("workspace.addPanelMenu.noMatches")}</CommandEmpty>
        );
      }
      return (
        <CommandGroup heading={t("commandPalette.searchResults")}>
          {ranked.map((action) => (
            <ActionCommandItem
              action={action}
              key={action.id}
              keybindingLabels={keybindingLabels}
              onExecute={executeAction}
            />
          ))}
        </CommandGroup>
      );
    }
    return (
      <CommandsView
        groups={groups}
        keybindingLabels={keybindingLabels}
        onExecute={executeAction}
      />
    );
  };
  return (
    <div className="flex h-full items-center justify-center px-1">
      <Popover
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setQuery("");
          }
        }}
        open={open}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                aria-label={t("workspace.tab.create")}
                size="icon-xs"
                type="button"
                variant="secondary"
              >
                <Plus data-icon="inline-start" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("workspace.tab.create")}
            {createShortcut ? (
              <span className="text-background/70 tracking-wide">
                {createShortcut}
              </span>
            ) : null}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          aria-labelledby={titleId}
          className="w-80 gap-0 overflow-hidden p-0"
          onEscapeKeyDown={(event) => {
            if (event.isComposing || event.keyCode === IME_PENDING_KEYCODE) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onPointerDownOutside={(event) => {
            // 仅终端向 outside 才 mark；点 trigger / 其它 web 控件不补终端聚焦。
            markWebOverlayOutsideDismissIfNeeded(
              CREATE_MENU_SCOPE,
              event.detail.originalEvent.target
            );
          }}
          style={{
            maxWidth:
              "calc(var(--radix-popover-content-available-width) - 0.5rem)",
          }}
        >
          {/* Popover 已经锚定在 "+" 按钮旁, 视觉上不需要重复标题;
              保留 sr-only 标题给 aria-labelledby 引用, 保 a11y。 */}
          <PopoverHeader className="sr-only">
            <PopoverTitle id={titleId}>
              {t("workspace.addPanelMenu.title")}
            </PopoverTitle>
          </PopoverHeader>
          <Command
            className="h-auto rounded-none pb-0 [&_[cmdk-item]]:rounded-2xl"
            label={t("workspace.addPanelMenu.title")}
            loop
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === IME_PENDING_KEYCODE
              ) {
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setQuery("");
              }
            }}
            onPointerMoveCapture={pointerSelectionGate.onPointerMoveCapture}
            shouldFilter={false}
          >
            <CommandInput
              aria-label={t("workspace.addPanelMenu.searchPlaceholder")}
              onValueChange={setQuery}
              placeholder={t("workspace.addPanelMenu.searchPlaceholder")}
              ref={inputRef}
              value={query}
            />
            <CommandList
              aria-labelledby={titleId}
              className="max-h-[min(60vh,400px)]"
              label={t("workspace.addPanelMenu.title")}
            >
              {renderListBody()}
            </CommandList>
          </Command>
          <CreateMenuManageAgents
            onClose={() => {
              setOpen(false);
              setQuery("");
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
