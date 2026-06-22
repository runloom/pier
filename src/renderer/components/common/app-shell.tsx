import { CommandPalette } from "@/components/common/command-palette.tsx";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";

export function AppShell() {
  return (
    <div className="h-full bg-background">
      <ShellKeybindings />
      <CommandPalette />
      <WorkspaceHost />
    </div>
  );
}
