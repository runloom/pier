import { CommandPalette } from "@/components/common/command-palette.tsx";
import { DocumentTitle } from "@/components/common/document-title.tsx";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { TerminalDebugSnapshotBridge } from "@/components/common/terminal-debug-snapshot-bridge.tsx";
import { TitleBar } from "@/components/common/title-bar.tsx";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";

const IS_MAC = window.pier?.platform === "darwin";

export function AppShell() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DocumentTitle />
      {IS_MAC && <TitleBar />}
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceHost />
      </div>
      <ShellKeybindings />
      <CommandPalette />
      <SettingsDialog />
      <TerminalDebugSnapshotBridge />
    </div>
  );
}
