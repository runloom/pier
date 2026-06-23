import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type SerializedDockview,
} from "dockview-react";
import { useCallback } from "react";
import "dockview-react/dist/styles/dockview.css";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { AddPanelAction } from "./add-panel-action.tsx";
import { panelComponents, panelKindOf } from "./panel-registry.ts";

/**
 * WorkspaceHost — dockview-react 的唯一业务边界。
 *
 * 所有 dockview API 操作必经此组件暴露的 useWorkspaceStore, 业务代码禁止直接
 * import dockview-react / dockview-core (由 dependency-cruiser 守护)。
 *
 * 当前职责:
 * - mount DockviewReact, onReady 时把 api 灌入 store
 * - 注册 panel 组件表 + tab 后 add 按钮 (leftHeaderActionsComponent)
 * - 初始创建一个 welcome panel
 *
 * 全局快捷键 dispatch 由 ShellKeybindings 组件统一管理;
 * panel actions 注册由 main.tsx bootstrap 统一调用。
 */
/**
 * Pier dockview theme 对象 — 配合 CSS class dockview-theme-pier 使用。
 *
 * gap: 4 — Pier 透明 WKWebView + 终端 NSView 架构下, panel content 区域被 NSView
 * 视觉覆盖, 任何渲染在 panel 内部的 web 元素都被遮挡 (含 sash 分割线). gap 让
 * 相邻 panel 之间留 4px 空隙, sash 与 dockview 内置 separator (.dv-view::before)
 * 渲染在 gap 内, 不被 NSView 覆盖.
 *
 * dndOverlayMounting: 'absolute' — 让 root drop overlay 渲染到 shell 根层级,
 * 配合 setOverlayActive 隐藏 terminal NSView 使 group drop overlay 也可见.
 */
const pierTheme: DockviewTheme = {
  name: "pier",
  className: "dockview-theme-pier",
  gap: 4,
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

export function WorkspaceHost() {
  const setApi = useWorkspaceStore((s) => s.setApi);

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

      // onDidLayoutChange 双责任: 标记 userTouched (防 fromJSON 覆盖) + debounced save
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      event.api.onDidLayoutChange(() => {
        if (isApplyingPersistedLayout) {
          return; // program-driven, 不算 user touched
        }
        userTouched = true;
        if (saveTimer) {
          clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
          saveTimer = null;
          try {
            const json = event.api.toJSON();
            window.pier.workspace.saveLayout(json).catch((err) => {
              console.error("[workspace] saveLayout failed:", err);
            });
          } catch (err) {
            console.error("[workspace] toJSON failed:", err);
          }
        }, SAVE_DEBOUNCE_MS);
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
            short: panel.title || "Panel",
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

      // 异步恢复持久化 layout — 仅在 user 未触碰时应用. 失败或无持久化 layout 时
      // 用 default. 注意: applyDefaultLayout / fromJSON 都包在 isApplyingPersistedLayout
      // gate 里, 同样防 save-loop.
      (async () => {
        let saved: unknown = null;
        try {
          saved = await window.pier.workspace.loadLayout();
        } catch (err) {
          console.error("[workspace] loadLayout failed:", err);
        }
        if (userTouched) {
          // user 已经在 layout 里加了 panel, 不覆盖
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
        // 给 dockview 一帧时间 flush layout-change 事件, 再放 save gate
        requestAnimationFrame(() => {
          isApplyingPersistedLayout = false;
        });
      })();
    },
    [setApi]
  );

  return (
    <div className="h-full w-full">
      <DockviewReact
        components={panelComponents}
        leftHeaderActionsComponent={AddPanelAction}
        onReady={handleReady}
        theme={pierTheme}
      />
    </div>
  );
}
