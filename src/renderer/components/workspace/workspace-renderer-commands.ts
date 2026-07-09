import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import { closeCurrentWindow } from "@/lib/ipc/window-ipc.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { requestTerminalRelaunch } from "@/stores/terminal-relaunch.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { closeNativeTerminalPanel } from "@/stores/workspace-terminal-close.ts";
import { panelKindOf } from "./panel-registry.ts";
import { buildWorkspacePanelSnapshots } from "./workspace-panel-snapshots.ts";

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

async function closePanelForCommand(panelId: string): Promise<void> {
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
  if (api.totalPanels <= 1) {
    if (panel.view.contentComponent === "terminal") {
      closeNativeTerminalPanel(panel.id);
    }
    await closeCurrentWindow();
    return;
  }
  await state.closePanel(panelId);
}

function addPanelForCommand(
  command: Extract<RendererCommandEnvelope["command"], { type: "panel.open" }>
): string {
  const panelId = useWorkspaceStore.getState().addTerminal({
    context: command.context,
    ...(command.placement && {
      placement: command.placement,
    }),
  });
  if (!panelId) {
    throw new Error("workspace api not ready");
  }
  return panelId;
}

function addTerminalForCommand(
  command: Extract<
    RendererCommandEnvelope["command"],
    { type: "terminal.open" }
  >
): string {
  if (!command.panelId) {
    const panelId = useWorkspaceStore.getState().addTerminal({
      ...(command.context && {
        context: command.context,
      }),
      ...(command.initialInput && { initialInput: command.initialInput }),
      launchId: command.launchId,
      ...(command.placement && {
        placement: command.placement,
      }),
      ...(command.tab && { tab: command.tab }),
      ...(command.task && { task: command.task }),
    });
    if (!panelId) {
      throw new Error("workspace api not ready");
    }
    return panelId;
  }

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
  requestTerminalRelaunch({
    panelId: command.panelId,
    launchId: command.launchId,
    ...(command.context && { context: command.context }),
    ...(command.initialInput && { initialInput: command.initialInput }),
    ...(command.tab && { tab: command.tab }),
    ...(command.task && { task: command.task }),
  });
  return command.panelId;
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
      case "panel.close": {
        await closePanelForCommand(envelope.command.panelId);
        window.pier.rendererCommand.resolve({
          data: null,
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "panel.open": {
        const panelId = addPanelForCommand(envelope.command);
        window.pier.rendererCommand.resolve({
          data: {
            context: envelope.command.context,
            panelId,
          },
          ok: true,
          requestId: envelope.requestId,
        });
        return;
      }
      case "terminal.open": {
        const panelId = addTerminalForCommand(envelope.command);
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
