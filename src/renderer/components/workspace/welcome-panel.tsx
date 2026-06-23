import type { IDockviewPanelProps } from "dockview-react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";

export function WelcomePanel(props: IDockviewPanelProps) {
  usePanelDescriptor(props.api, { short: "Welcome", long: "Welcome" });
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="font-semibold text-2xl text-foreground">Pier</h1>
        <p className="mt-2 text-muted-foreground text-sm">本地 AI 开发工作台</p>
      </div>
    </div>
  );
}
