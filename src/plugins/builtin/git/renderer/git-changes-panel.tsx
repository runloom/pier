import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";

/**
 * git-changes 占位面板。第一阶段只渲染占位文案。
 * 已 i18n 化的标题/提示由插件 activate 经 PluginPanelRegistration.getParams 注入,
 * 组件从 props.params 读 —— 插件不能直接 import renderer 的 i18n hook。
 * 故意不调用 usePanelDescriptor;tab 标题由 panels.register 的 title 经 addPanel 设置。
 * 未来填真实内容、需要向宿主发布 PanelContext 时,要经插件 API 补对应机制。
 */
export function GitChangesPanel(
  props: IDockviewPanelProps<{ heading?: string; hint?: string }>
) {
  const heading = props.params?.heading ?? "Git Changes";
  const hint = props.params?.hint ?? "Change preview coming soon";
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="font-semibold text-foreground text-lg">{heading}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{hint}</p>
      </div>
    </div>
  );
}
