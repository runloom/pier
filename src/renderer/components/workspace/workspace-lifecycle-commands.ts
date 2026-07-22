import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import i18next from "i18next";
import { pluginLifecycleBarriers } from "@/lib/plugins/plugin-lifecycle-barriers.ts";
import { rendererPluginRuntime } from "@/lib/plugins/runtime.ts";
import {
  canSkipWorkspaceLayoutFlushForInitialClose,
  flushWorkspaceLayout,
  WorkspaceLayoutPersistenceError,
} from "@/lib/workspace/workspace-layout-persistence.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

const LIFECYCLE_COMMAND_TYPES = new Set([
  "plugin.finalizeDisable",
  "plugin.finalizeReload",
  "plugin.prepareDisable",
  "plugin.prepareReload",
  "workspace.finalizeClose",
  "workspace.flushLayout",
  "workspace.prepareClose",
  "workspace.reportCloseFailure",
]);

function layoutPersistenceFailureFallback(
  state: "starting" | "unavailable"
): string {
  const isChinese = document.documentElement.lang.startsWith("zh");
  if (state === "starting") {
    return isChinese
      ? "工作区仍在启动，暂时无法安全保存布局。"
      : "The workspace is still starting, so its layout could not be saved yet.";
  }
  return isChinese
    ? "工作区当前不可用，无法安全保存布局。"
    : "The workspace is unavailable, so its layout could not be saved safely.";
}

function closeFailureTitle(): string {
  const fallback = document.documentElement.lang.startsWith("zh")
    ? "无法关闭窗口"
    : "Unable to close window";
  return i18next.isInitialized
    ? i18next.t("workspace.closeFailure.title", { defaultValue: fallback })
    : fallback;
}

function lifecycleFailureMessage(error: unknown): string {
  if (error instanceof WorkspaceLayoutPersistenceError) {
    const fallback = layoutPersistenceFailureFallback(error.state);
    return i18next.isInitialized
      ? i18next.t(`workspace.closeFailure.${error.state}`, {
          defaultValue: fallback,
        })
      : fallback;
  }
  return error instanceof Error ? error.message : String(error);
}

function resolveRendererCommand(requestId: string): void {
  window.pier.rendererCommand.resolve({
    data: null,
    ok: true,
    requestId,
  });
}

async function compensateFailedPluginPreparation(input: {
  error: unknown;
  generation: number;
  pluginId: string;
  transitionId: string;
}): Promise<never> {
  let failure = input.error;
  try {
    await finalizeRendererPluginTransition({
      generation: input.generation,
      outcome: "abort",
      pluginId: input.pluginId,
      transitionId: input.transitionId,
    });
  } catch (compensationError) {
    failure = new AggregateError(
      [input.error, compensationError],
      `plugin lifecycle preparation and abort compensation failed: ${input.pluginId}`
    );
  }
  throw failure;
}

async function finalizeRendererPluginTransition(input: {
  generation: number;
  outcome: "abort" | "commit";
  pluginId: string;
  transitionId: string;
}): Promise<void> {
  const failures: unknown[] = [];
  try {
    await pluginLifecycleBarriers.finalize(input.transitionId, input.outcome);
  } catch (error) {
    failures.push(error);
  }
  try {
    await rendererPluginRuntime.finalizeExternalTransition(
      input.pluginId,
      input.transitionId,
      input.generation,
      input.outcome
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `plugin renderer finalization failed: ${input.pluginId}`
    );
  }
}

export function isWorkspaceLifecycleCommand(
  envelope: RendererCommandEnvelope
): boolean {
  return LIFECYCLE_COMMAND_TYPES.has(envelope.command.type);
}

export async function runWorkspaceLifecycleCommand(
  envelope: RendererCommandEnvelope
): Promise<void> {
  try {
    if (envelope.command.type === "workspace.prepareClose") {
      try {
        await pluginLifecycleBarriers.prepareAll(
          envelope.command.reason,
          envelope.command.transitionId
        );
        if (!canSkipWorkspaceLayoutFlushForInitialClose()) {
          await flushWorkspaceLayout();
        }
      } catch (error) {
        try {
          await pluginLifecycleBarriers.finalize(
            envelope.command.transitionId,
            "abort"
          );
        } catch (compensationError) {
          throw new AggregateError(
            [error, compensationError],
            "workspace close preparation and abort compensation failed"
          );
        }
        throw error;
      }
    } else if (envelope.command.type === "workspace.finalizeClose") {
      await pluginLifecycleBarriers.finalize(
        envelope.command.transitionId,
        envelope.command.outcome
      );
    } else if (envelope.command.type === "plugin.prepareDisable") {
      const accepted = rendererPluginRuntime.prepareExternalTransition(
        envelope.command.pluginId,
        "plugin-disable",
        envelope.command.transitionId,
        envelope.command.generation
      );
      try {
        if (!accepted) {
          return resolveRendererCommand(envelope.requestId);
        }
        await pluginLifecycleBarriers.prepare(
          envelope.command.pluginId,
          "plugin-disable",
          envelope.command.transitionId
        );
      } catch (error) {
        await compensateFailedPluginPreparation({
          error,
          generation: envelope.command.generation,
          pluginId: envelope.command.pluginId,
          transitionId: envelope.command.transitionId,
        });
      }
    } else if (envelope.command.type === "plugin.finalizeDisable") {
      await finalizeRendererPluginTransition({
        generation: envelope.command.generation,
        outcome: envelope.command.outcome,
        pluginId: envelope.command.pluginId,
        transitionId: envelope.command.transitionId,
      });
    } else if (envelope.command.type === "plugin.prepareReload") {
      const accepted = rendererPluginRuntime.prepareExternalTransition(
        envelope.command.pluginId,
        "plugin-reload",
        envelope.command.transitionId,
        envelope.command.generation
      );
      try {
        if (!accepted) {
          return resolveRendererCommand(envelope.requestId);
        }
        await pluginLifecycleBarriers.prepare(
          envelope.command.pluginId,
          "plugin-reload",
          envelope.command.transitionId
        );
      } catch (error) {
        await compensateFailedPluginPreparation({
          error,
          generation: envelope.command.generation,
          pluginId: envelope.command.pluginId,
          transitionId: envelope.command.transitionId,
        });
      }
    } else if (envelope.command.type === "plugin.finalizeReload") {
      await finalizeRendererPluginTransition({
        generation: envelope.command.generation,
        outcome: envelope.command.outcome,
        pluginId: envelope.command.pluginId,
        transitionId: envelope.command.transitionId,
      });
    } else if (envelope.command.type === "workspace.flushLayout") {
      await flushWorkspaceLayout();
    } else if (envelope.command.type === "workspace.reportCloseFailure") {
      // showAppAlert 的 Promise 表示“用户已关闭弹窗”，不是“弹窗已呈现”。
      // 这里在同步入队后立即确认，避免用户阅读超过 main 的命令超时时间时
      // 被误判为 renderer 反馈失败，再触发原生兜底形成双提示。
      showAppAlert({
        body: envelope.command.body,
        title: closeFailureTitle(),
      });
    } else {
      throw new Error(
        `unsupported workspace lifecycle command: ${envelope.command.type}`
      );
    }
    resolveRendererCommand(envelope.requestId);
  } catch (error) {
    window.pier.rendererCommand.resolve({
      error: {
        ...(error instanceof WorkspaceLayoutPersistenceError
          ? { code: error.code }
          : {}),
        message: lifecycleFailureMessage(error),
      },
      ok: false,
      requestId: envelope.requestId,
    });
  }
}
