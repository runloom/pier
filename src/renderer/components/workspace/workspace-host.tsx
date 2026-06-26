import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type SerializedDockview,
} from "dockview-react";
import { useCallback, useEffect, useRef } from "react";
import "dockview-react/dist/styles/dockview.css";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { setDockviewTabRevealRoot } from "@/lib/workspace/tab-visibility.ts";
import { activateTerminalPanelFromFocusRequest } from "@/lib/workspace/terminal-focus-request.ts";
import { flushTerminalLayoutFramesTrailing } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { panelComponents, panelKindOf } from "./panel-registry.ts";
import { PanelTabHeader } from "./panel-tab-header.tsx";
import { WorkspaceHeaderActions } from "./workspace-header-actions.tsx";
import { buildWorkspacePanelSnapshots } from "./workspace-panel-snapshots.ts";

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
/**
 * Pier dockview theme 对象 — 配合 CSS class dockview-theme-pier 使用。
 *
 * gap: 0 — Pier 透明 WKWebView + 终端 NSView 架构下, panel content 区域被 NSView
 * 视觉覆盖. 新 sash ::before 内线方案直接渲染在 .dv-sash 容器上 (sash z-index: 99
 * 在 NSView 之上), 不再依赖 panel 间空隙暴露视觉线; gap 改 0 避免 panel 之间透明缝隙
 * 跟 sash 内线并列显示成"两条线"伪影.
 *
 * dndOverlayMounting: 'absolute' — 让 root drop overlay 渲染到 shell 根层级,
 * 配合 setOverlayActive 暂停 EventRouter 拦截, 使 group drop overlay 可接收输入.
 */
const pierTheme: DockviewTheme = {
  name: "pier",
  className: "dockview-theme-pier",
  gap: 0,
  dndOverlayMounting: "absolute",
};

/** 默认布局: 单 terminal panel. 当持久化 layout 不存在或恢复失败时使用. */
function applyDefaultLayout(api: DockviewReadyEvent["api"]): void {
  api.addPanel({
    id: "terminal-1",
    component: "terminal",
    title: "Terminal",
  });
}

const SAVE_DEBOUNCE_MS = 500;

class RendererCommandExecutionError extends Error {
  readonly code: PierCommandErrorCode;

  constructor(code: PierCommandErrorCode, message: string) {
    super(message);
    this.name = "RendererCommandExecutionError";
    this.code = code;
  }
}

function rendererCommandErrorCode(
  code: "kind_mismatch" | "not_found"
): PierCommandErrorCode {
  return code === "kind_mismatch" ? "invalid_command" : code;
}

function panelSnapshots() {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    throw new Error("workspace api not ready");
  }
  return buildWorkspacePanelSnapshots(
    api,
    usePanelDescriptorStore.getState().descriptors
  );
}

function focusPanel(panelId: string, expectedKind?: "terminal" | "web"): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    throw new Error("workspace api not ready");
  }
  const result = activateWorkspacePanel(api, panelId, {
    ...(expectedKind && { expectedKind }),
    kindOfComponent: panelKindOf,
    reveal: "always",
  });
  if (!result.ok) {
    throw new RendererCommandExecutionError(
      rendererCommandErrorCode(result.code),
      result.message
    );
  }
}

function runRendererCommand(envelope: RendererCommandEnvelope): void {
  try {
    const state = useWorkspaceStore.getState();
    switch (envelope.command.type) {
      case "panel.list": {
        window.pier.rendererCommand.resolve({
          data: panelSnapshots(),
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.focus": {
        focusPanel(envelope.command.panelId);
        window.pier.rendererCommand.resolve({
          data: null,
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.open": {
        const panelId = state.addTerminal({
          context: envelope.command.context,
          ...(envelope.command.placement && {
            placement: envelope.command.placement,
          }),
        });
        if (!panelId) {
          throw new Error("workspace api not ready");
        }
        window.pier.rendererCommand.resolve({
          data: {
            context: envelope.command.context,
            panelId,
          },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "workspace.flushLayout": {
        throw new Error("workspace.flushLayout requires workspace api context");
      }
      default: {
        const _exhaustive: never = envelope.command;
        throw new Error(`unsupported renderer command: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    window.pier.rendererCommand.resolve({
      error: {
        ...(error instanceof RendererCommandExecutionError
          ? { code: error.code }
          : {}),
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
      requestId: envelope.requestId,
    });
  }
}

export function WorkspaceHost() {
  const setApi = useWorkspaceStore((s) => s.setApi);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDockviewTabRevealRoot(rootRef.current);
    return () => {
      setDockviewTabRevealRoot(null);
    };
  }, []);

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      // setApi 立即暴露 — bootstrap 阶段 keymap action (Cmd+T 等) 可能在 layout
      // 异步加载完成前触发, 延迟暴露 api 会让 action handler 调 store.addTerminal
      // 时 api=null 静默 drop, 用户感受是"快捷键失效, 按两次才行".
      setApi(event.api);

      // 防 save-loop: fromJSON / 默认 layout 应用期间 onDidLayoutChange 触发的
      // change event 是 program-driven, 不该 save (会 round-trip 存"恢复出来的"
      // 同样内容). flag 在 isApplyingPersistedLayout=true 期间 fire 的 change 都跳过.
      let isApplyingPersistedLayout = false;

      // 防 fromJSON race: user 在 loadLayout pending 期间手动操作 layout (按 Cmd+T
      // / 拖 panel 等), userTouched=true. loadLayout 完成时如果 user 已操作, fromJSON
      // 跳过 (不覆盖 user 操作) — user 显式新建的 panel 优先于磁盘旧 layout.
      let userTouched = false;
      let didNotifyReadyToShow = false;
      const windowContextPromise = window.pier.getWindowContext();

      const notifyReadyToShow = (): void => {
        if (didNotifyReadyToShow) {
          return;
        }
        didNotifyReadyToShow = true;
        // 此时 BrowserWindow 仍是 show:false, 隐藏页面的 requestAnimationFrame 可能
        // 不推进; 用 macrotask 接在同步 layout restore 后通知 main 显示窗口.
        setTimeout(() => {
          window.pier.readyToShow();
        }, 0);
      };

      const saveCurrentLayout = async (): Promise<void> => {
        const json = event.api.toJSON();
        const windowContext = await windowContextPromise;
        await window.pier.workspace.saveLayout(json, windowContext.recordId);
      };

      const flushCurrentLayout = async (
        envelope: RendererCommandEnvelope
      ): Promise<void> => {
        try {
          const windowContext = await windowContextPromise;
          if (event.api.totalPanels === 0) {
            await window.pier.workspace.clearLayout(windowContext.recordId);
          } else {
            await window.pier.workspace.saveLayout(
              event.api.toJSON(),
              windowContext.recordId
            );
          }
          window.pier.rendererCommand.resolve({
            data: null,
            ok: true,
            requestId: envelope.requestId,
          });
        } catch (error) {
          window.pier.rendererCommand.resolve({
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
            ok: false,
            requestId: envelope.requestId,
          });
        }
      };

      // onDidLayoutChange 双责任: 标记 userTouched (防 fromJSON 覆盖) + debounced save
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      event.api.onDidLayoutChange(() => {
        if (isApplyingPersistedLayout) {
          return; // program-driven, 不算 user touched
        }
        userTouched = true;
        flushTerminalLayoutFramesTrailing("dockview-layout");
        if (saveTimer) {
          clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
          saveTimer = null;
          saveCurrentLayout().catch((err) => {
            console.error("[workspace] saveLayout failed:", err);
          });
        }, SAVE_DEBOUNCE_MS);
      });

      event.api.onDidMaximizedGroupChange(() => {
        flushTerminalLayoutFramesTrailing("dockview-maximize");
      });

      // Active panel 变化 (含同 group 切 tab, panel 创建/删除导致 active 切换) →
      // 同步 scopeStore + 通过 IPC 通知 swift firstResponder swap. panel 可能为
      // null (无 active panel), 此时 fall back 到 "web" + null panelId 防 terminal
      // 抢 firstResponder. getState() 是 imperative 用法, 不是 React hook.
      event.api.onDidActivePanelChange((panel) => {
        // dockview 是 active 的唯一来源 — 集中推送给 PanelDescriptorStore,
        // 各 sink (DocumentTitle / TitleBar) 据此显示当前聚焦 panel 的呈现信息.
        //
        // 占位 descriptor:setActive 是同步, 但 panel React 组件的 useEffect
        // (内含 usePanelDescriptor.upsert) 要 commit 后异步跑. 新建 panel 时
        // 有一帧 activeId=new 但 descriptors[new]=undefined, sink 退回 "Pier"
        // 造成闪烁. 先用 panel.title 占位 (panel.title 是 dockview 同步可读的初始值),
        // panel 自己的 useEffect 跑起来时会用真实计算结果覆盖.
        const descriptorStore = usePanelDescriptorStore.getState();
        if (panel && !descriptorStore.descriptors[panel.id]) {
          descriptorStore.upsert(panel.id, {
            display: { short: panel.title || "Panel" },
          });
        }
        descriptorStore.setActive(panel?.id ?? null);

        if (!panel) {
          useKeybindingScope.getState().setActivePanel(null, null, null);
          window.pier?.terminal?.setActivePanelKind?.("web", null);
          return;
        }
        const component = panel.view.contentComponent;
        const kind = panelKindOf(component);
        useKeybindingScope.getState().setActivePanel(kind, component, panel.id);
        window.pier?.terminal?.setActivePanelKind?.(kind, panel.id);
      });

      window.pier?.terminal?.onFocusRequest?.((req) => {
        const result = activateTerminalPanelFromFocusRequest(
          event.api,
          req.panelId,
          {
            kindOfComponent: panelKindOf,
          }
        );
        if (result.ok) {
          window.pier?.terminal?.setActivePanelKind?.("terminal", req.panelId);
        }
      });

      window.pier?.workspace?.onNewTerminalRequest?.(() => {
        useWorkspaceStore.getState().addTerminal();
      });

      window.pier.rendererCommand.onCommand((envelope) => {
        if (envelope.command.type === "workspace.flushLayout") {
          flushCurrentLayout(envelope).catch((error) => {
            console.error("[workspace] flushLayout failed:", error);
          });
          return;
        }
        runRendererCommand(envelope);
      });

      // 异步恢复持久化 layout — 仅在 user 未触碰时应用. 失败或无持久化 layout 时
      // 用 default. 注意: applyDefaultLayout / fromJSON 都包在 isApplyingPersistedLayout
      // gate 里, 同样防 save-loop.
      (async () => {
        let saved: unknown = null;
        try {
          const windowContext = await windowContextPromise;
          saved = await window.pier.workspace.loadLayout(
            windowContext.recordId
          );
        } catch (err) {
          console.error("[workspace] loadLayout failed:", err);
        }
        if (userTouched) {
          // user 已经在 layout 里加了 panel, 不覆盖
          notifyReadyToShow();
          return;
        }
        isApplyingPersistedLayout = true;
        try {
          if (saved && typeof saved === "object") {
            event.api.fromJSON(saved as SerializedDockview);
          } else {
            applyDefaultLayout(event.api);
          }
        } catch (err) {
          console.error("[workspace] fromJSON failed, fallback default:", err);
          applyDefaultLayout(event.api);
        }

        // C 方案 reload 零销毁的孤儿兜底:layout 应用后报告当前还活着的 terminal
        // panelId 集合, swift 把 reload 前 layout 里有、新 layout 里没有的 NSView
        // 清掉. 首次启动 / layout 未变 时是 noop (swift terminals 字典空 / 集合一致),
        // 只有 reload 后 layout 收缩时才真正回收孤儿. fire-and-forget.
        const terminalPanelIds = event.api.panels
          .filter((p) => p.view.contentComponent === "terminal")
          .map((p) => p.id);
        window.pier?.terminal?.reconcile?.(terminalPanelIds);
        notifyReadyToShow();

        // 给 dockview 一帧时间 flush layout-change 事件, 再放 save gate
        requestAnimationFrame(() => {
          isApplyingPersistedLayout = false;
        });
      })();
    },
    [setApi]
  );

  return (
    <div className="h-full w-full overflow-hidden" ref={rootRef}>
      <DockviewReact
        components={panelComponents}
        defaultTabComponent={PanelTabHeader}
        disableTabsOverflowList={true}
        leftHeaderActionsComponent={WorkspaceHeaderActions}
        onReady={handleReady}
        theme={pierTheme}
      />
    </div>
  );
}
