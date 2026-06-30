import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";

/**
 * git-changes 占位面板。第一阶段只渲染占位文案。
 * 故意不调用 usePanelDescriptor —— 插件代码不能 import renderer hook;
 * tab 标题由 panels.register 的 title 经 addPanel 设置。未来填真实内容、
 * 需要向宿主发布 PanelContext 时,要经插件 API 补对应机制(不能直接用该 hook)。
 */
export function GitChangesPanel(_props: IDockviewPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="font-semibold text-foreground text-lg">Git 变更</h1>
        <p className="mt-2 text-muted-foreground text-sm">变更预览即将到来</p>
      </div>
    </div>
  );
}
