import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { useCallback, useEffect } from "react";
import "dockview-react/dist/styles/dockview.css";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { useKeyboardShortcuts } from "@/lib/keybindings/use-keybindings.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { AddPanelAction } from "./add-panel-action.tsx";
import { panelComponents } from "./panel-registry.ts";

/**
 * WorkspaceHost — dockview-react 的唯一业务边界。
 *
 * 所有 dockview API 操作必经此组件暴露的 useWorkspaceStore, 业务代码禁止直接
 * import dockview-react / dockview-core (由 dependency-cruiser 守护)。
 *
 * 当前职责:
 * - mount DockviewReact, onReady 时把 api 灌入 store
 * - 注册 panel 组件表 + tab 后 add 按钮 (leftHeaderActionsComponent)
 * - 注册 panel actions (close active 等) + 挂全局快捷键 dispatch
 * - 初始创建一个 welcome panel
 */
export function WorkspaceHost() {
  const setApi = useWorkspaceStore((s) => s.setApi);
  useKeyboardShortcuts();

  // panel actions 注册一次; disposer 在 unmount 时释放.
  useEffect(() => registerPanelActions(), []);

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      setApi(event.api);
      // 初始 welcome panel
      event.api.addPanel({
        id: "welcome-1",
        component: "welcome",
        title: "Welcome",
      });
    },
    [setApi]
  );

  return (
    <div className="h-full w-full">
      <DockviewReact
        className="dockview-theme-abyss"
        components={panelComponents}
        leftHeaderActionsComponent={AddPanelAction}
        onReady={handleReady}
      />
    </div>
  );
}
