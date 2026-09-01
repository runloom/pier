import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import i18next from "i18next";
import { openGitChangesPanelHost } from "@/lib/comments/open-git-changes.ts";
import { openFilesDiskPathForCommand } from "@/lib/files/open-disk-file-panel.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import {
  rejectTerminalLaunch,
  waitForTerminalLaunch,
} from "@/lib/workspace/terminal-launch-confirmation.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { requestTerminalRelaunch } from "@/stores/terminal-relaunch.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { referenceGroupById } from "@/stores/workspace-panel-helpers.ts";
import { isWorkspaceBootstrapGateActive } from "./bootstrap-gate.ts";
import { panelKindOf } from "./panel-registry.ts";
import { buildWorkspacePanelSnapshots } from "./panel-snapshots.ts";

class RendererCommandExecutionError extends Error {
  readonly code: PierCommandErrorCode;

  constructor(code: PierCommandErrorCode, message: string) {
    super(message);
    this.name = "RendererCommandExecutionError";
    this.code = code;
  }
}

function rendererCommandErrorCode(
  code: "kind_mismatch" | "not_found"
): PierCommandErrorCode {
  return code === "kind_mismatch" ? "invalid_command" : code;
}

function panelSnapshots() {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    throw new Error("workspace api not ready");
  }
  return buildWorkspacePanelSnapshots(
    api,
    usePanelDescriptorStore.getState().descriptors
  );
}

function focusPanel(panelId: string, expectedKind?: "terminal" | "web"): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    throw new Error("workspace api not ready");
  }
  const result = activateWorkspacePanel(api, panelId, {
    ...(expectedKind && { expectedKind }),
    kindOfComponent: panelKindOf,
    reveal: "always",
  });
  if (!result.ok) {
    throw new RendererCommandExecutionError(
      rendererCommandErrorCode(result.code),
      result.message
    );
  }
}

function assertUserMutationAllowed(): void {
  if (isWorkspaceBootstrapGateActive()) {
    throw new RendererCommandExecutionError(
      "cancelled",
      "workspace bootstrap gate is active"
    );
  }
}

async function closePanelForCommand(panelId: string): Promise<void> {
  assertUserMutationAllowed();
  const state = useWorkspaceStore.getState();
  const api = state.api;
  if (!api) {
    throw new Error("workspace api not ready");
  }
  const panel = api.panels.find((candidate) => candidate.id === panelId);
  if (!panel) {
    throw new RendererCommandExecutionError(
      "not_found",
      `panel not found: ${panelId}`
    );
  }
  const closed = await state.closePanel(panelId);
  if (!closed) {
    throw new RendererCommandExecutionError(
      "cancelled",
      `panel close cancelled: ${panelId}`
    );
  }
}

async function addTerminalForCommand(
  command: Extract<
    RendererCommandEnvelope["command"],
    { type: "terminal.open" }
  >
): Promise<string> {
  assertUserMutationAllowed();
  const launchConfirmation = waitForTerminalLaunch(command.launchId);
  let panelId: string | undefined;
  try {
    if (command.panelId && command.referencePanelId) {
      throw new RendererCommandExecutionError(
        "invalid_command",
        "terminal.open cannot combine panelId and referencePanelId"
      );
    }
    if (command.panelId) {
      const api = useWorkspaceStore.getState().api;
      if (!api) {
        throw new Error("workspace api not ready");
      }
      const panel = api.panels.find(
        (candidate) => candidate.id === command.panelId
      );
      if (!panel) {
        throw new RendererCommandExecutionError(
          "not_found",
          `panel not found: ${command.panelId}`
        );
      }
      if (panelKindOf(panel.view.contentComponent) !== "terminal") {
        throw new RendererCommandExecutionError(
          "invalid_command",
          `panel is not a terminal: ${command.panelId}`
        );
      }
      if (command.focus !== false) {
        focusPanel(command.panelId, "terminal");
      }
      if (command.exitPresentation) {
        panel.api.updateParameters({
          ...panel.params,
          exitPresentation: command.exitPresentation,
        });
      }
      requestTerminalRelaunch({
        panelId: command.panelId,
        launchId: command.launchId,
        ...(command.context && { context: command.context }),
        ...(command.exitPresentation && {
          exitPresentation: command.exitPresentation,
        }),
        ...(command.initialInput && {
          initialInput: command.initialInput,
          initialInputSubmit: command.initialInputSubmit !== false,
        }),
        ...(command.tab && { tab: command.tab }),
        ...(command.task && { task: command.task }),
      });
      panelId = command.panelId;
    } else {
      const workspace = useWorkspaceStore.getState();
      const referenceGroupOptions = command.targetGroupId
        ? referenceGroupById(workspace.api, command.targetGroupId)
        : {};
      if (command.targetGroupId && !referenceGroupOptions.referenceGroup) {
        if (!workspace.api) {
          throw new Error("workspace api not ready");
        }
        throw new RendererCommandExecutionError(
          "not_found",
          `panel group not found: ${command.targetGroupId}`
        );
      }
      if (command.referencePanelId) {
        const api = workspace.api;
        if (!api) {
          throw new Error("workspace api not ready");
        }
        const reference = api.panels.find(
          (candidate) => candidate.id === command.referencePanelId
        );
        if (!reference) {
          throw new RendererCommandExecutionError(
            "not_found",
            `reference panel not found: ${command.referencePanelId}`
          );
        }
      }
      panelId =
        workspace.addTerminal({
          ...(command.backgroundCreate && {
            backgroundCreate: command.backgroundCreate,
          }),
          ...(command.context && {
            context: command.context,
          }),
          ...(command.exitPresentation && {
            exitPresentation: command.exitPresentation,
          }),
          ...(command.focus !== undefined && {
            focus: command.focus,
          }),
          ...(command.initialInput && {
            initialInput: command.initialInput,
            initialInputSubmit: command.initialInputSubmit !== false,
          }),
          launchId: command.launchId,
          ...(command.placement && {
            placement: command.placement,
          }),
          ...(command.referencePanelId && {
            referencePanelId: command.referencePanelId,
          }),
          ...referenceGroupOptions,
          ...(command.tab && { tab: command.tab }),
          ...(command.task && { task: command.task }),
        }) ?? undefined;
      if (!panelId) {
        throw new Error("workspace api not ready");
      }
    }
  } catch (error) {
    rejectTerminalLaunch(
      command.launchId,
      error instanceof Error ? error : String(error)
    );
  }
  await launchConfirmation;
  if (!panelId) {
    throw new Error("terminal panel was not created");
  }
  return panelId;
}

export function runWorkspaceRendererCommand(
  envelope: RendererCommandEnvelope
): Promise<void> {
  return runWorkspaceRendererCommandAsync(envelope);
}

async function runWorkspaceRendererCommandAsync(
  envelope: RendererCommandEnvelope
): Promise<void> {
  try {
    switch (envelope.command.type) {
      case "dialog.confirm": {
        // v1: canvasCommand.invoke is the only caller. Copy stays
        // canvas-scoped so we do not grow a generic confirm envelope.
        const commandText = envelope.command.command;
        const confirmed = await showAppConfirm({
          body: i18next.t("canvas.command.confirmBody", {
            command: commandText,
            defaultValue: "This canvas wants to run:\n\n{{command}}",
          }),
          cancelLabel: i18next.t("canvas.command.cancelLabel", {
            defaultValue: "Cancel",
          }),
          confirmLabel: i18next.t("canvas.command.confirmLabel", {
            defaultValue: "Run",
          }),
          intent: envelope.command.intent,
          title: i18next.t("canvas.command.confirmTitle", {
            defaultValue: "Run this command?",
          }),
        });
        window.pier.rendererCommand.resolve({
          data: confirmed,
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.list": {
        window.pier.rendererCommand.resolve({
          data: panelSnapshots(),
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.focus": {
        focusPanel(envelope.command.panelId);
        window.pier.rendererCommand.resolve({
          data: null,
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.setSize": {
        const result = useWorkspaceStore.getState().setPanelSize({
          panelId: envelope.command.panelId,
          ...(envelope.command.widthRatio === undefined
            ? {}
            : { widthRatio: envelope.command.widthRatio }),
          ...(envelope.command.heightRatio === undefined
            ? {}
            : { heightRatio: envelope.command.heightRatio }),
        });
        if (!result.ok) {
          throw new RendererCommandExecutionError(
            result.code ?? "invalid_command",
            result.message ?? "panel.setSize failed"
          );
        }
        window.pier.rendererCommand.resolve({
          data: { panelId: envelope.command.panelId },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.equalize": {
        const result = useWorkspaceStore.getState().equalizePanelGroup({
          axis: envelope.command.axis,
          panelIds: envelope.command.panelIds,
        });
        if (!result.ok) {
          throw new RendererCommandExecutionError(
            result.code ?? "invalid_command",
            result.message ?? "panel.equalize failed"
          );
        }
        window.pier.rendererCommand.resolve({
          data: { panelIds: envelope.command.panelIds },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.close": {
        await closePanelForCommand(envelope.command.panelId);
        window.pier.rendererCommand.resolve({
          data: null,
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "git.openReviewPanel": {
        assertUserMutationAllowed();
        const opened = openGitChangesPanelHost({
          context: envelope.command.context,
        });
        if (!opened.ok) {
          throw new RendererCommandExecutionError(
            "platform_unavailable",
            "git changes panel is unavailable in this window"
          );
        }
        window.pier.rendererCommand.resolve({
          data: { panelId: opened.panelId },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "files.openDisk": {
        assertUserMutationAllowed();
        const opened = openFilesDiskPathForCommand({
          path: envelope.command.path,
          root: envelope.command.root,
          ...(envelope.command.revealTree === undefined
            ? {}
            : { revealTree: envelope.command.revealTree }),
          ...(envelope.command.column === undefined
            ? {}
            : { column: envelope.command.column }),
          ...(envelope.command.context
            ? { context: envelope.command.context }
            : {}),
          ...(envelope.command.line === undefined
            ? {}
            : { line: envelope.command.line }),
          ...(envelope.command.placement
            ? { placement: envelope.command.placement }
            : {}),
          ...(envelope.command.referencePanelId
            ? { referencePanelId: envelope.command.referencePanelId }
            : {}),
        });
        if (!opened.ok) {
          throw new RendererCommandExecutionError(
            opened.reason === "invalid-path"
              ? "invalid_command"
              : "platform_unavailable",
            i18next.t("terminal.openPathFailed", {
              defaultValue: "Couldn't open path — try again",
            })
          );
        }
        window.pier.rendererCommand.resolve({
          data: {
            panelId: opened.panelId,
            reused: opened.reused,
          },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "terminal.open": {
        const panelId = await addTerminalForCommand(envelope.command);
        window.pier.rendererCommand.resolve({
          data: {
            ...(envelope.command.context && {
              context: envelope.command.context,
            }),
            panelId,
          },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "workspace.flushLayout": {
        throw new Error("workspace.flushLayout requires workspace api context");
      }
      case "workspace.prepareClose": {
        throw new Error(
          "workspace.prepareClose requires workspace api context"
        );
      }
      case "workspace.finalizeClose": {
        throw new Error(
          "workspace.finalizeClose requires workspace api context"
        );
      }
      case "workspace.reportCloseFailure": {
        throw new Error(
          "workspace.reportCloseFailure requires workspace api context"
        );
      }
      case "plugin.prepareDisable": {
        throw new Error("plugin.prepareDisable requires workspace api context");
      }
      case "plugin.finalizeDisable": {
        throw new Error(
          "plugin.finalizeDisable requires workspace api context"
        );
      }
      case "plugin.prepareReload": {
        throw new Error("plugin.prepareReload requires workspace api context");
      }
      case "plugin.finalizeReload": {
        throw new Error("plugin.finalizeReload requires workspace api context");
      }
      // panelTransfer.* commands are routed earlier by the workspace renderer
      // command listener (installWorkspaceRendererCommandListener) and never
      // reach this switch. They are listed here only so the `never`
      // exhaustiveness check stays satisfied; the cases are unreachable.
      case "panelTransfer.prepareSource":
      case "panelTransfer.stageTarget":
      case "panelTransfer.releaseSource":
      case "panelTransfer.finalize":
      case "panelTransfer.resolvePlacement":
      case "panelTransfer.resolveDefaultPlacement":
      case "panelTransfer.probeWorkspace": {
        throw new Error(
          `${envelope.command.type} must be routed by the panel-transfer listener`
        );
      }
      default: {
        const _exhaustive: never = envelope.command;
        throw new Error(`unsupported renderer command: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    window.pier.rendererCommand.resolve({
      error: {
        ...(error instanceof RendererCommandExecutionError
          ? { code: error.code }
          : {}),
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
      requestId: envelope.requestId,
    });
  }
}
