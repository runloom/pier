import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";

export function AppShell() {
  return (
    <div className="h-full bg-background">
      <WorkspaceHost />
    </div>
  );
}
