import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { useCallback } from "react";
import "dockview-react/dist/styles/dockview.css";
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
 * - 初始创建一个 welcome panel
 *
 * 全局快捷键 dispatch 由 ShellKeybindings 组件统一管理;
 * panel actions 注册由 main.tsx bootstrap 统一调用。
 */
export function WorkspaceHost() {
  const setApi = useWorkspaceStore((s) => s.setApi);

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      setApi(event.api);
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
