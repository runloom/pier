import { Button } from "@pier/ui/button.tsx";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Plus } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/**
 * Tab 栏 add 按钮 — dockview leftHeaderActionsComponent 模式.
 *
 * dockview header DOM 顺序: preActions → tabs → leftActions → void → rightActions.
 * leftHeaderActionsComponent 渲染在 tabs 之后 (tab 后), 用 direction:"within"
 * 把新 panel 作为当前 group 的新 tab 插入, 而非新建 group.
 */
export function AddPanelAction(props: IDockviewHeaderActionsProps) {
  const handleAdd = () => {
    useWorkspaceStore.getState().addTerminal({
      referenceGroup: props.group,
    });
  };

  return (
    <div className="flex h-full items-center justify-center px-1">
      <Button
        aria-label="New Tab"
        onClick={handleAdd}
        size="icon-xs"
        title="New Tab"
        type="button"
        variant="secondary"
      >
        <Plus />
      </Button>
    </div>
  );
}
