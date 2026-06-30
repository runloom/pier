import type { IDockviewPanelProps } from "dockview-react";
import { GitBranch } from "lucide-react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";

export function GitChangesPanel(props: IDockviewPanelProps) {
  usePanelDescriptor(props.api, {
    display: { long: "Git 变更", short: "Git" },
  });
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="font-semibold text-foreground text-lg">Git 变更</h1>
        <p className="mt-2 text-muted-foreground text-sm">变更预览即将到来</p>
      </div>
    </div>
  );
}

export const gitChangesPanelKit = {
  component: GitChangesPanel,
  icon: GitBranch,
  kind: "web",
} as const;
