/**
 * Tab 栏 add 按钮 — 同源锚定创建器.
 *
 * 数据源: actionRegistry.list("create-menu"), 与命令面板共享同一套
 * action 注册、frecency 排序、搜索算法和行渲染.
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
import type { IDockviewHeaderActionsProps } from "dockview-react";
import i18next from "i18next";
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
import { ActionCommandItem } from "@/components/common/command-palette-action-rows.tsx";
import { useT } from "@/i18n/use-t.ts";
import {
  actionRegistry,
  getActionRegistryVersion,
  subscribeActionRegistry,
} from "@/lib/actions/registry.ts";
import type { Action, ActionInvocation } from "@/lib/actions/types.ts";
import {
  actionCategoryKey,
  rankActionsForPalette,
} from "@/lib/command-palette/action-search.ts";
import { CATEGORY_META } from "@/lib/command-palette/frecency.ts";
import { useCommandPointerSelectionGate } from "@/lib/command-palette/use-command-pointer-selection-gate.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import {
  getKeybindingRegistryVersion,
  keybindingRegistry,
  subscribeKeybindingRegistry,
} from "@/lib/keybindings/registry.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";
import { useCreateMenuRequestStore } from "@/stores/create-menu-request.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

const CREATE_MENU_SCOPE = "overlay:add-panel";
const IME_PENDING_KEYCODE = 229;

interface CreateActionGroup {
  actions: Action[];
  category: string;
}

const CREATE_MENU_CATEGORY_ORDER: Readonly<Record<string, number>> = {
  run: 0,
  panel: 1,
  worktree: 2,
};

function createMenuFallbackPriority(action: Action): number {
  if (action.id === "pier.panel.newTerminal") {
    return 0;
  }
  if (action.id === "pier.agent.new") {
    return 1;
  }
  if (action.id.startsWith("pier.agent.start.")) {
    return action.metadata?.sortOrder ?? 10;
  }
  if (action.id === "pier.run.task") {
    return 100;
  }
  return 200 + (action.metadata?.sortOrder ?? 0);
}

function compareCreateActions(
  a: Action,
  b: Action,
  frecencyMap: ReadonlyMap<string, number>
): number {
  const aScore = frecencyMap.get(a.id);
  const bScore = frecencyMap.get(b.id);
  if (aScore != null && bScore != null) {
    if (bScore !== aScore) {
      return bScore - aScore;
    }
    return createMenuFallbackPriority(a) - createMenuFallbackPriority(b);
  }
  if (aScore != null) {
    return -1;
  }
  if (bScore != null) {
    return 1;
  }
  return createMenuFallbackPriority(a) - createMenuFallbackPriority(b);
}

function maxGroupFrecency(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): number | undefined {
  let max: number | undefined;
  for (const action of actions) {
    const score = frecencyMap.get(action.id);
    if (score != null && (max == null || score > max)) {
      max = score;
    }
  }
  return max;
}

function compareCreateGroups(
  a: CreateActionGroup,
  b: CreateActionGroup,
  frecencyMap: ReadonlyMap<string, number>
): number {
  const aScore = maxGroupFrecency(a.actions, frecencyMap);
  const bScore = maxGroupFrecency(b.actions, frecencyMap);
  if (aScore != null && bScore != null) {
    return bScore - aScore;
  }
  if (aScore != null) {
    return -1;
  }
  if (bScore != null) {
    return 1;
  }
  const aOrder =
    CREATE_MENU_CATEGORY_ORDER[a.category] ??
    100 + (CATEGORY_META[a.category]?.order ?? 100);
  const bOrder =
    CREATE_MENU_CATEGORY_ORDER[b.category] ??
    100 + (CATEGORY_META[b.category]?.order ?? 100);
  return aOrder - bOrder;
}

function groupCreateActions(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): CreateActionGroup[] {
  const byCategory = new Map<string, Action[]>();
  for (const action of actions) {
    const category = actionCategoryKey(action);
    const categoryActions = byCategory.get(category) ?? [];
    categoryActions.push(action);
    byCategory.set(category, categoryActions);
  }
  const groups = Array.from(byCategory.entries()).map(
    ([category, categoryActions]) => ({
      actions: categoryActions.sort((a, b) =>
        compareCreateActions(a, b, frecencyMap)
      ),
      category,
    })
  );
  return groups.sort((a, b) => compareCreateGroups(a, b, frecencyMap));
}

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
          const first = keybindingRegistry.getFirstBindingFor(
            action.id,
            action.metadata?.shortcutSourceId
          );
          if (first) {
            map.set(action.id, formatChord(first.chord));
          }
        }
        return map;
      }),
    [actions, keybindingVersion]
  );
}

export function AddPanelAction(props: IDockviewHeaderActionsProps) {
  const t = useT();
  // Contextual action thunks use getState(); this subscription keeps their
  // enabled state and disabled reason current while the creator stays open.
  usePanelDescriptorStore((state) =>
    props.activePanel ? state.descriptors[props.activePanel.id] : undefined
  );
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const detectionGenerationRef = useRef(0);
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
        ? groupCreateActions(allCreateActions, frecencyMap)
        : [],
    [allCreateActions, frecencyMap, normalizedQuery]
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
    // A reopened creator may share the same in-flight probe; only its current
    // generation reports a rejection.
    const detectionGeneration = detectionGenerationRef.current + 1;
    detectionGenerationRef.current = detectionGeneration;
    useAgentDetectStore
      .getState()
      .ensureDetected()
      .catch(async (error) => {
        if (detectionGenerationRef.current !== detectionGeneration) {
          return;
        }
        await showAppAlert({
          body: error instanceof Error ? error.message : String(error),
          title: i18next.t("workspace.addPanelMenu.detectAgentsFailed"),
        });
      });
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
      if (detectionGenerationRef.current === detectionGeneration) {
        detectionGenerationRef.current += 1;
      }
      useKeybindingScope.getState().popBlockingScope(CREATE_MENU_SCOPE);
      releaseOverlayRoute.dispose();
      releaseWebFocus();
      invocationRef.current = null;
    };
  }, [open, props.activePanel, sourceActionInvocation]);

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

  const categoryHeading = (category: string) => {
    const meta = CATEGORY_META[category];
    return meta ? t(`commandPalette.category.${meta.labelKey}`) : category;
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
    return groups.map((group) => (
      <CommandGroup
        heading={categoryHeading(group.category)}
        key={group.category}
      >
        {group.actions.map((action) => (
          <ActionCommandItem
            action={action}
            key={action.id}
            keybindingLabels={keybindingLabels}
            onExecute={executeAction}
          />
        ))}
      </CommandGroup>
    ));
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
        <PopoverTrigger asChild>
          <Button
            aria-label={t("workspace.addPanelMenu.trigger")}
            size="icon-xs"
            title={t("workspace.addPanelMenu.trigger")}
            type="button"
            variant="secondary"
          >
            <Plus data-icon="inline-start" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-labelledby={titleId}
          className="w-80 gap-0 p-0 shadow-xl ring-0"
          onEscapeKeyDown={(event) => {
            if (event.isComposing || event.keyCode === IME_PENDING_KEYCODE) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
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
            className="h-auto [&_[cmdk-item]]:rounded-2xl"
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
