import { AgentIndexChromeBar } from "@/components/common/agent-index-chrome-bar.tsx";
import { AgentRuntimeIndexBridge } from "@/components/common/agent-runtime-index-bridge.tsx";
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { AppQuitDialogBridge } from "@/components/common/app-quit-dialog-bridge.tsx";
import { AppUpdateBridge } from "@/components/common/app-update-bridge.tsx";
import { CommandPalette } from "@/components/common/command-palette.tsx";
import { DiffWorkerHost } from "@/components/common/diff-worker-host.tsx";
import { DocumentTitle } from "@/components/common/document-title.tsx";
import { ForegroundActivityBridge } from "@/components/common/foreground-activity-bridge.tsx";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { TaskOutputSyncBridge } from "@/components/common/task-output-sync-bridge.tsx";
import { TaskRunsErrorBridge } from "@/components/common/task-runs-error-bridge.tsx";
import { TerminalDebugSnapshotBridge } from "@/components/common/terminal-debug-snapshot-bridge.tsx";
import { TitleBar } from "@/components/common/title-bar.tsx";
import { UsageDataBridge } from "@/components/common/usage-data-bridge.tsx";
import { Toaster } from "@/components/primitives/sonner.tsx";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";

const IS_MAC = window.pier?.env?.platform === "darwin";

export function AppShell() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DocumentTitle />
      {IS_MAC ? <TitleBar /> : <AgentIndexChromeBar />}
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffWorkerHost>
          <WorkspaceHost />
        </DiffWorkerHost>
      </div>
      <ShellKeybindings />
      <CommandPalette />
      <SettingsDialog />
      <AppQuitDialogBridge />
      <AppDialogHost />
      <AppContentDialogHost />
      <TerminalDebugSnapshotBridge />
      <ForegroundActivityBridge />
      <AppUpdateBridge />
      <AgentRuntimeIndexBridge />
      <UsageDataBridge />
      <TaskRunsErrorBridge />
      <TaskOutputSyncBridge />
      <Toaster />
    </div>
  );
}
