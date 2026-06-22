import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Plus } from "lucide-react";

/**
 * Tab 栏 add 按钮 — dockview leftHeaderActionsComponent 模式.
 *
 * dockview header DOM 顺序: preActions → tabs → leftActions → void → rightActions.
 * leftHeaderActionsComponent 渲染在 tabs 之后 (tab 后), 用 direction:"within"
 * 把新 panel 作为当前 group 的新 tab 插入, 而非新建 group.
 */
export function AddPanelAction(props: IDockviewHeaderActionsProps) {
  const handleAdd = () => {
    const id = `terminal-${Date.now()}`;
    props.containerApi.addPanel({
      id,
      component: "terminal",
      title: "Terminal",
      position: {
        referenceGroup: props.group,
        direction: "within",
      },
    });
  };

  return (
    <button
      className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      onClick={handleAdd}
      title="New Tab"
      type="button"
    >
      <Plus className="size-4" />
    </button>
  );
}
