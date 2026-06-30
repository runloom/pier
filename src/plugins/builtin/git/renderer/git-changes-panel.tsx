import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";

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
