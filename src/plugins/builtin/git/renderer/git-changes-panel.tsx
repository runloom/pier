import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";

/**
 * git-changes 占位面板。当前阶段仅保留入口和占位文案，实际 Git 快捷操作
 * 全部由插件命令面板 action 承载。
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
