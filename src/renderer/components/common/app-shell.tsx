import { CommandPalette } from "@/components/common/command-palette.tsx";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { TitleBar } from "@/components/common/title-bar.tsx";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";

const IS_MAC = window.pier?.platform === "darwin";

export function AppShell() {
  return (
    <div className="flex h-full flex-col bg-background">
      {IS_MAC && <TitleBar />}
      <ShellKeybindings />
      <CommandPalette />
      <div className="min-h-0 flex-1">
        <WorkspaceHost />
      </div>
      <SettingsDialog />
    </div>
  );
}
