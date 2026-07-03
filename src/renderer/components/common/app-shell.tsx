import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { CommandPalette } from "@/components/common/command-palette.tsx";
import { DocumentTitle } from "@/components/common/document-title.tsx";
import { ForegroundActivityBridge } from "@/components/common/foreground-activity-bridge.tsx";
import { PluginOverlayHost } from "@/components/common/plugin-overlay-host.tsx";
import { ProjectBridge } from "@/components/common/project-bridge.tsx";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { TerminalDebugSnapshotBridge } from "@/components/common/terminal-debug-snapshot-bridge.tsx";
import { TitleBar } from "@/components/common/title-bar.tsx";
import { Toaster } from "@/components/primitives/sonner.tsx";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";

const IS_MAC = window.pier?.env?.platform === "darwin";

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
      <AppDialogHost />
      <PluginOverlayHost />
      <TerminalDebugSnapshotBridge />
      <ForegroundActivityBridge />
      <ProjectBridge />
      <Toaster />
    </div>
  );
}
