import { CommandPalette } from "@/components/common/command-palette.tsx";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";

export function AppShell() {
  return (
    <div className="h-full bg-background">
      <ShellKeybindings />
      <CommandPalette />
      <WorkspaceHost />
      <SettingsDialog />
    </div>
  );
}
