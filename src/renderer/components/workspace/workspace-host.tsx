import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import "dockview-react/dist/styles/dockview.css";
import { dismissAllTooltips, TooltipProvider } from "@pier/ui/tooltip.tsx";
import { useCommittedValue } from "@/hooks/use-committed-ref.ts";
import {
  getPluginPanelRevision,
  setPluginPanelCloser,
  setPluginPanelTitleUpdater,
  subscribePluginPanelRegistry,
} from "@/lib/plugins/plugin-panel-registry.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { activateTerminalPanelFromFocusRequest } from "@/lib/workspace/terminal-focus-request.ts";
import {
  markWorkspaceLayoutPersistenceStarting,
  markWorkspaceLayoutPersistenceUnavailable,
  registerWorkspaceLayoutFlusher,
} from "@/lib/workspace/workspace-layout-persistence.ts";
import {
  flushTerminalLayoutFramesTrailing,
  setTerminalLayoutPresentationScheduler,
  type TerminalLayoutFlushReason,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import {
  requestTerminalPresentation,
  type TerminalPresentationWorkspaceState,
  updateTerminalPresentationWorkspace,
} from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import {
  requestTerminalFocusIntent,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { attachWorkspacePanelTransfer } from "./attach-workspace-panel-transfer.ts";
import { getPanelComponents, panelKindOf } from "./panel-registry.ts";
import { PanelTabHeader } from "./panel-tab-header.tsx";
import { applyDefaultLayout } from "./workspace-default-layout.ts";
import {
  WorkspaceHeaderActions,
  WorkspaceHeaderRightActions,
} from "./workspace-header-actions.tsx";
import {
  createWorkspaceLayoutSaveScheduler,
  subscribeWorkspacePanelParameterChanges,
} from "./workspace-layout-persistence.ts";
import {
  enterPendingTransferBootstrapGate,
  loadWorkspaceLayoutWithPendingTransfers,
  restoreAndSanitizeTransferLayout,
  settlePendingTransferBootstrap,
} from "./workspace-panel-transfer-host.ts";
import {
  createPluginPanelCloserForWorkspace,
  createPluginPanelTitleUpdaterForWorkspace,
} from "./workspace-plugin-panel-bridge.ts";
import { pierTheme } from "./workspace-theme.ts";

/**
 * WorkspaceHost — dockview-react 的唯一业务边界。
 *
 * 所有 dockview API 操作必经此组件暴露的 useWorkspaceStore, 业务代码禁止直接
 * import dockview-react / dockview-core (由 dependency-cruiser 守护)。
 *
 * 当前职责:
 * - mount DockviewReact, onReady 时把 api 灌入 store
 * - 注册 panel 组件表 + tab 后 header actions
 * - 初始创建一个 welcome panel
 *
 * 全局快捷键 dispatch 由 ShellKeybindings 组件统一管理;
 * panel actions 注册由 main.tsx bootstrap 统一调用。
 */
const SAVE_DEBOUNCE_MS = 500;

type WorkspacePanel = DockviewReadyEvent["api"]["panels"][number];

function syncActivePanelScope(panel: WorkspacePanel | null | undefined): void {
  if (!panel) {
    useKeybindingScope.getState().setActivePanel(null, null, null);
    setTerminalBasePanel({ kind: "web" });
    return;
  }
  const component = panel.view.contentComponent;
  const kind = panelKindOf(component);
  useKeybindingScope.getState().setActivePanel(kind, component, panel.id);
  if (kind === "terminal") {
    requestTerminalFocusIntent(panel.id);
  } else {
    setTerminalBasePanel({ kind: "web" });
  }
}

function buildTerminalWorkspacePresentationState(
  api: DockviewReadyEvent["api"]
): TerminalPresentationWorkspaceState {
  const activePanel = api.activePanel;
  const activePanelKind = activePanel
    ? panelKindOf(activePanel.view.contentComponent)
    : "web";
  return {
    activePanelId: activePanel?.id ?? null,
    activeTerminalPanelId:
      activePanelKind === "terminal" ? (activePanel?.id ?? null) : null,
    hasMaximizedGroup: api.hasMaximizedGroup(),
    panels: api.panels.map((panel) => ({
      component: panel.view.contentComponent,
      dockviewActive: panel.api.isActive,
      dockviewVisible: panel.api.isVisible,
      id: panel.id,
    })),
  };
}

function reconcileTerminalPanels(api: DockviewReadyEvent["api"]): void {
  const terminalPanelIds = api.panels
    .filter((panel) => panel.view.contentComponent === "terminal")
    .map((panel) => panel.id);
  window.pier?.terminal?.reconcile?.(terminalPanelIds);
}

function syncTerminalPresentation(
  api: DockviewReadyEvent["api"],
  flushReason: TerminalLayoutFlushReason
): void {
  useWorkspaceStore.getState().syncTabShortcutHints();
  updateTerminalPresentationWorkspace(
    buildTerminalWorkspacePresentationState(api),
    flushReason
  );
  flushTerminalLayoutFramesTrailing(flushReason);
  reconcileTerminalPanels(api);
}

export function WorkspaceHost() {
  const setApi = useWorkspaceStore((s) => s.setApi);
  const setWorkspaceHasMaximizedGroup = useWorkspaceStore(
    (s) => s.setHasMaximizedGroup
  );
  const [hasMaximizedGroup, setHasMaximizedGroup] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const workspaceLayoutFlushDisposeRef = useRef<() => void>(() => undefined);
  const workspaceRuntimeDisposeRef = useRef<() => void>(() => undefined);
  // 插件 panel 在 bootstrapBuiltinPlugins()（main.tsx, App render 前）注册;
  // 首次 render 时已就绪。同时订阅插件注册表变化(revision),Settings 启用/禁用插件后
  // 重算 dockview 组件表,避免 useMemo([]) 留下陈旧 snapshot。
  // useSyncExternalStore 的 snapshot 必须引用稳定,所以返回 revision 数字而非对象;
  // 组件表用 useMemo(revision) 派生。
  const panelRevision = useSyncExternalStore(
    subscribePluginPanelRegistry,
    getPluginPanelRevision,
    getPluginPanelRevision
  );
  const panelComponents = useMemo(
    () => readVersionedSnapshot(panelRevision, getPanelComponents),
    [panelRevision]
  );
  // 给 handleReady 闭包用:sanitize 需要"当前已注册的 component 名集合",
  // 但 handleReady 是稳定 useCallback,不应把 panelComponents 加进 deps
  // (否则 dockview re-init); ref 让 onReady 时读到最新值。
  const readPanelComponents = useCommittedValue(panelComponents);

  useEffect(() => {
    setDockviewTabRevealRoot(rootRef.current);
    return () => {
      setDockviewTabRevealRoot(null);
    };
  }, []);

  useEffect(
    () => setTerminalLayoutPresentationScheduler(requestTerminalPresentation),
    []
  );

  // WorkspaceHost unmount 时清掉模块级 panelCloser —— closer 闭包持的是旧
  // event.api,若不清,下次 mount 前的插件 dispose 会 removePanel 到死 api 上。
  useEffect(
    () => () => {
      setPluginPanelCloser(null);
      setPluginPanelTitleUpdater(null);
    },
    []
  );
  useEffect(() => {
    markWorkspaceLayoutPersistenceStarting();
    return () => {
      workspaceRuntimeDisposeRef.current();
      workspaceRuntimeDisposeRef.current = () => undefined;
      workspaceLayoutFlushDisposeRef.current();
      workspaceLayoutFlushDisposeRef.current = () => undefined;
      setApi(null);
      setWorkspaceHasMaximizedGroup(false);
      syncActivePanelScope(null);
      markWorkspaceLayoutPersistenceUnavailable();
    };
  }, [setApi, setWorkspaceHasMaximizedGroup]);

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      workspaceRuntimeDisposeRef.current();
      // setApi 立即暴露 — bootstrap 阶段 keymap action (Cmd+T 等) 可能在 layout
      // 异步加载完成前触发, 延迟暴露 api 会让 action handler 调 store.addTerminal
      // 时 api=null 静默 drop, 用户感受是"快捷键失效, 按两次才行".
      setApi(event.api);

      // 注入插件 panel 关闭钩子:插件 dispose(禁用/卸载)时关掉其已打开的 dockview
      // 实例,避免遗留 panel 在下次 fromJSON 找不到 component。
      // 按 contentComponent 匹配而非 id —— 分屏快捷键会创建同 component 但生成新 id
      // 的副本,光关单例会留下残留。同 component 的所有 panel 一起清理。
      // 若关完后会让 workspace 全空,先补一个 welcome 占位,避免空 workspace 被
      // debounce 持久化为空布局(用户视角:禁用插件不应清空整个工作区)。
      setPluginPanelCloser(createPluginPanelCloserForWorkspace(event.api));
      setPluginPanelTitleUpdater(
        createPluginPanelTitleUpdaterForWorkspace(event.api)
      );

      // 防 save-loop: fromJSON / 默认 layout 应用期间 onDidLayoutChange 触发的
      // change event 是 program-driven, 不该 save (会 round-trip 存"恢复出来的"
      // 同样内容). flag 在 isApplyingPersistedLayout=true 期间 fire 的 change 都跳过.
      let isApplyingPersistedLayout = false;

      // 防 fromJSON race: user 在 loadLayout pending 期间手动操作 layout (按 Cmd+T
      // / 拖 panel 等), userTouched=true. loadLayout 完成时如果 user 已操作, fromJSON
      // 跳过 (不覆盖 user 操作) — user 显式新建的 panel 优先于磁盘旧 layout.
      let userTouched = false;
      const windowContextPromise = window.pier.window.getContext();
      let flushRecordId: string | null = null;
      windowContextPromise
        .then((windowContext) => {
          flushRecordId = windowContext.recordId;
        })
        .catch(() => {
          // getContext 失败时 flush 兜底静默失效; 常规 save 路径自会重试并报错。
        });

      const notifyWorkspaceReady = (): void => {
        setWorkspaceReady(true);
      };

      const saveCurrentLayout = async (): Promise<void> => {
        const json = event.api.toJSON();
        const windowContext = await windowContextPromise;
        await window.pier.workspace.saveLayout(json, windowContext.recordId);
      };
      const layoutSave = createWorkspaceLayoutSaveScheduler({
        delayMs: SAVE_DEBOUNCE_MS,
        onError: (error) =>
          console.error("[workspace] saveLayout failed:", error),
        save: saveCurrentLayout,
      });

      const persistCurrentLayout = async (): Promise<void> => {
        layoutSave.cancelPending();
        const windowContext = await windowContextPromise;
        if (event.api.totalPanels === 0) {
          await window.pier.workspace.clearLayout(windowContext.recordId);
        } else {
          await window.pier.workspace.saveLayout(
            event.api.toJSON(),
            windowContext.recordId
          );
        }
      };
      workspaceLayoutFlushDisposeRef.current();
      workspaceLayoutFlushDisposeRef.current =
        registerWorkspaceLayoutFlusher(persistCurrentLayout);
      // 跨窗口 panel transfer: Dockview drag 事件 + dragend/Escape。
      const panelTransferDispose = attachWorkspacePanelTransfer(event.api);

      const syncDockviewMaximizedState = (): void => {
        const nextHasMaximizedGroup = event.api.hasMaximizedGroup();
        rootRef.current?.setAttribute(
          "data-dockview-maximized",
          nextHasMaximizedGroup ? "true" : "false"
        );
        setHasMaximizedGroup(nextHasMaximizedGroup);
        setWorkspaceHasMaximizedGroup(nextHasMaximizedGroup);
      };

      // 结构变化与 panel params 变化都属于 layout JSON 的组成部分。dockview 的
      // onDidLayoutChange 不包含 updateParameters，因此两条事件必须汇入同一个
      // debounce 保存入口，否则浮层位置、工作台物料等参数只能活到本次渲染。
      const layoutSubscription = event.api.onDidLayoutChange(() => {
        if (isApplyingPersistedLayout) {
          return; // program-driven, 不算 user touched
        }
        userTouched = true;
        syncTerminalPresentation(event.api, "dockview-layout");
        layoutSave.schedule();
      });
      const parameterChangesDispose = subscribeWorkspacePanelParameterChanges(
        event.api,
        () => {
          if (isApplyingPersistedLayout) {
            return;
          }
          userTouched = true;
          layoutSave.schedule();
        }
      );

      // 关 500ms debounce 空窗：reload/关窗时若有未落盘的 layout 变更, 立即
      // 补发 save。invoke 消息投递即达 main, renderer teardown 不影响 main
      // 写盘（否则面板创建后 <500ms 内 reload 会恢复到旧 layout——新面板
      // 从 UI 消失, 其活 pty 被 reconcile 判孤儿回收）。
      const handleBeforeUnload = (): void => {
        if (!(layoutSave.cancelPending() && flushRecordId)) {
          return;
        }
        window.pier.workspace
          .saveLayout(event.api.toJSON(), flushRecordId)
          .catch(() => {
            // teardown 期 response 通道可能已断; main 侧写盘不受影响。
          });
      };
      window.addEventListener("beforeunload", handleBeforeUnload);

      const maximizedSubscription = event.api.onDidMaximizedGroupChange(() => {
        syncDockviewMaximizedState();
        syncActivePanelScope(event.api.activePanel);
        syncTerminalPresentation(event.api, "dockview-maximize");
      });

      // Active panel 变化 (含同 group 切 tab, panel 创建/删除导致 active 切换) →
      // 同步 scopeStore + 通过 IPC 通知 swift firstResponder swap. panel 可能为
      // null (无 active panel), 此时 fall back 到 "web" + null panelId 防 terminal
      // 抢 firstResponder. getState() 是 imperative 用法, 不是 React hook.
      const handleActivePanelChange: Parameters<
        typeof event.api.onDidActivePanelChange
      >[0] = (change) => {
        // dockview v7: payload 是 { panel, origin },不再直接传 panel。
        // dockview 是 active 的唯一来源 — 集中推送给 PanelDescriptorStore,
        // 各 sink (DocumentTitle / TitleBar) 据此显示当前聚焦 panel 的呈现信息.
        //
        // 占位 descriptor:setActive 是同步, 但 panel React 组件的 useEffect
        // (内含 usePanelDescriptor.upsert) 要 commit 后异步跑. 新建 panel 时
        // 有一帧 activeId=new 但 descriptors[new]=undefined, sink 退回 "Pier"
        // 造成闪烁. 先用 panel.title 占位 (panel.title 是 dockview 同步可读的初始值),
        // panel 自己的 useEffect 跑起来时会用真实计算结果覆盖.
        const panel = change.panel;
        const descriptorStore = usePanelDescriptorStore.getState();
        if (panel && !descriptorStore.descriptors[panel.id]) {
          descriptorStore.upsert(panel.id, {
            display: { short: panel.title || "Panel" },
          });
        }
        descriptorStore.setActive(panel?.id ?? null);

        // 程序化切 tab / 关闭面板等路径指针未必移动, 主动收掉残留 tooltip.
        dismissAllTooltips();

        syncActivePanelScope(panel);
        syncTerminalPresentation(event.api, "dockview-active-panel");
      };
      const activePanelSubscription = event.api.onDidActivePanelChange(
        handleActivePanelChange
      );

      const terminalFocusDispose =
        window.pier?.terminal?.onFocusRequest?.((req) => {
          const result = activateTerminalPanelFromFocusRequest(
            event.api,
            req.panelId,
            {
              kindOfComponent: panelKindOf,
            }
          );
          if (result.ok) {
            // 终端焦点意图：让任何活跃的共存浮层（如搜索栏）让出键盘但保持可见，
            // effective 随 basePanel=terminal 转向终端。
            useTerminalStore.getState().yieldToTerminal();
            requestTerminalFocusIntent(req.panelId);
            syncTerminalPresentation(event.api, "dockview-active-panel");
          }
        }) ?? (() => undefined);

      const newTerminalDispose =
        window.pier?.workspace?.onNewTerminalRequest?.(() => {
          useWorkspaceStore.getState().addTerminal();
        }) ?? (() => undefined);

      // 异步恢复持久化 layout — 仅在 user 未触碰时应用; pending transfer bootstrap
      // 见 workspace-panel-transfer-host.ts。applyDefaultLayout / fromJSON 都包在
      // isApplyingPersistedLayout gate 里防 save-loop。
      let disposed = false;
      (async () => {
        const windowContext = await windowContextPromise.catch(() => null);
        const { saved, pendingTransfers } =
          await loadWorkspaceLayoutWithPendingTransfers(
            windowContext?.recordId
          );
        if (disposed) {
          return;
        }
        if (userTouched) {
          // user 已经在 layout 里加了 panel, 不覆盖
          notifyWorkspaceReady();
          return;
        }
        const hasPendingTransfers =
          enterPendingTransferBootstrapGate(pendingTransfers);
        isApplyingPersistedLayout = true;
        try {
          const sanitized = restoreAndSanitizeTransferLayout(
            saved,
            new Set(Object.keys(readPanelComponents()))
          );
          if (sanitized) {
            event.api.fromJSON(sanitized);
          } else {
            applyDefaultLayout(event.api);
          }
          syncDockviewMaximizedState();
          syncActivePanelScope(event.api.activePanel);
          syncTerminalPresentation(event.api, "restore");
        } catch (err) {
          console.error("[workspace] fromJSON failed, fallback default:", err);
          applyDefaultLayout(event.api);
          syncDockviewMaximizedState();
          syncActivePanelScope(event.api.activePanel);
          syncTerminalPresentation(event.api, "restore");
        }

        // C 方案 reload 零销毁的孤儿兜底: layout 应用后报告仍存活的 terminal
        // panelId；swift 回收 reload 前有、新 layout 没有的 NSView。
        reconcileTerminalPanels(event.api);
        notifyWorkspaceReady();

        if (hasPendingTransfers) {
          await settlePendingTransferBootstrap(pendingTransfers);
        }

        // 给 dockview 一帧时间 flush layout-change 事件, 再放 save gate
        requestAnimationFrame(() => {
          if (!disposed) {
            isApplyingPersistedLayout = false;
          }
        });
      })();

      workspaceRuntimeDisposeRef.current = () => {
        disposed = true;
        layoutSave.cancelPending();
        layoutSubscription?.dispose();
        parameterChangesDispose();
        maximizedSubscription?.dispose();
        activePanelSubscription?.dispose();
        terminalFocusDispose();
        newTerminalDispose();
        panelTransferDispose();
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    },
    [readPanelComponents, setApi, setWorkspaceHasMaximizedGroup]
  );

  return (
    <div
      className="h-full w-full overflow-hidden"
      data-dockview-maximized={hasMaximizedGroup ? "true" : "false"}
      data-testid="workspace-host-root"
      data-workspace-ready={workspaceReady ? "true" : "false"}
      ref={rootRef}
    >
      <TooltipProvider skipDelayDuration={0}>
        <DockviewReact
          components={panelComponents}
          defaultTabComponent={PanelTabHeader}
          disableTabsOverflowList={true}
          dndStrategy="html5"
          leftHeaderActionsComponent={WorkspaceHeaderActions}
          onReady={handleReady}
          rightHeaderActionsComponent={WorkspaceHeaderRightActions}
          theme={pierTheme}
        />
      </TooltipProvider>
    </div>
  );
}
