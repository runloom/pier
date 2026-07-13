import type {
  TaskOutputPanelParams,
  TaskOutputUpdate,
  TaskRunControlEntry,
  TaskRunNodeStatus,
} from "@shared/contracts/tasks.ts";
import {
  selectedTaskOutputRunId,
  taskOutputBindingGeneration,
} from "@shared/contracts/tasks.ts";
import type { TaskService } from "../services/tasks/task-service.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { suppressNextTerminalSurfaceClose } from "./terminal-task-lifecycle-wiring.ts";

interface OutputBinding {
  browserWindowId: number;
  finished: boolean;
  lastSequence: number;
  lastWasCarriageReturn: boolean;
  nativePanelId: string;
  ownerWindowId?: string | undefined;
  params: TaskOutputPanelParams;
}

export interface TaskOutputTerminalBindings {
  attach(args: {
    browserWindowId: number;
    nativePanelId: string;
    ownerWindowId?: string | undefined;
    params: TaskOutputPanelParams;
  }): { error?: string; ok: boolean };
  detach(nativePanelId: string): void;
  dispose(): void;
  rebind(args: {
    nativePanelId: string;
    ownerWindowId?: string | undefined;
    params: TaskOutputPanelParams;
  }): {
    error?: string;
    generation?: number;
    ok: boolean;
    stale?: boolean;
  };
  retainWindow(
    browserWindowId: number,
    nativePanelIds: readonly string[]
  ): void;
}

function isTerminalStatus(status: TaskRunNodeStatus): boolean {
  return (
    status === "blocked" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded"
  );
}

function normalizeLineEndings(binding: OutputBinding, text: string): string {
  let result = "";
  for (const character of text) {
    if (character === "\n" && !binding.lastWasCarriageReturn) {
      result += "\r";
    }
    result += character;
    binding.lastWasCarriageReturn = character === "\r";
  }
  return result;
}

function exitCodeFor(run: TaskRunControlEntry, taskId: string): number {
  const node = run.nodes[taskId];
  if (node?.exitCode !== undefined) {
    return node.exitCode;
  }
  if (node?.status === "succeeded" || run.status === "succeeded") {
    return 0;
  }
  if (node?.status === "cancelled" || run.status === "cancelled") {
    return 130;
  }
  return 1;
}

/**
 * 后台任务输出与 Ghostty 内存终端之间的唯一绑定层。
 *
 * TaskService 仍拥有进程、输出和运行状态；这里仅负责按 sequence 回放/追加、
 * 换行适配和结束通知。键盘输入由原生内存会话的空 write handler 消化，不会
 * 反向写入任务进程。
 */
export function createTaskOutputTerminalBindings(args: {
  addon: NativeAddon;
  onSurfaceReset?:
    | ((browserWindowId: number, nativePanelId: string) => void)
    | undefined;
  taskService: TaskService;
}): TaskOutputTerminalBindings {
  const { addon, onSurfaceReset, taskService } = args;
  const bindings = new Map<string, OutputBinding>();

  const resetSurface = (
    browserWindowId: number,
    nativePanelId: string
  ): boolean => {
    if (!addon.resetTerminalOutput(nativePanelId)) {
      return false;
    }
    onSurfaceReset?.(browserWindowId, nativePanelId);
    return true;
  };

  const writeText = (binding: OutputBinding, text: string): boolean => {
    if (!text) {
      return true;
    }
    return addon.writeTerminalOutput(
      binding.nativePanelId,
      Buffer.from(normalizeLineEndings(binding, text), "utf8")
    );
  };

  const applyOutput = (
    binding: OutputBinding,
    update: TaskOutputUpdate
  ): boolean => {
    for (const chunk of [...update.chunks].sort(
      (left, right) => left.sequence - right.sequence
    )) {
      if (chunk.sequence <= binding.lastSequence) {
        continue;
      }
      if (!writeText(binding, chunk.text)) {
        return false;
      }
      binding.lastSequence = chunk.sequence;
    }
    return true;
  };

  const finish = (binding: OutputBinding, run: TaskRunControlEntry): void => {
    if (binding.finished) {
      return;
    }
    const status = run.nodes[binding.params.taskId]?.status ?? run.status;
    if (!isTerminalStatus(status)) {
      return;
    }
    binding.finished = true;
    addon.finishTerminalOutput(
      binding.nativePanelId,
      exitCodeFor(run, binding.params.taskId),
      Math.max(0, run.updatedAt - run.startedAt)
    );
  };

  const hydrate = (binding: OutputBinding): boolean => {
    const runId = selectedTaskOutputRunId(binding.params);
    const output = taskService.output(runId, binding.params.taskId);
    if (!output) {
      writeText(
        binding,
        "\x1b[2m[pier] Task output is no longer available.\x1b[0m\n"
      );
      binding.finished = true;
      addon.finishTerminalOutput(binding.nativePanelId, 1, 0);
      return true;
    }
    if (output.truncated) {
      writeText(
        binding,
        "\x1b[2m[pier] Earlier task output was truncated.\x1b[0m\n"
      );
    }
    if (!applyOutput(binding, output)) {
      return false;
    }
    const run = taskService.runsSnapshot(binding.ownerWindowId).runs[runId];
    if (run) {
      finish(binding, run);
    }
    return true;
  };

  const createBinding = (args: {
    browserWindowId: number;
    nativePanelId: string;
    ownerWindowId?: string | undefined;
    params: TaskOutputPanelParams;
  }): OutputBinding => ({
    browserWindowId: args.browserWindowId,
    finished: false,
    lastSequence: 0,
    lastWasCarriageReturn: false,
    nativePanelId: args.nativePanelId,
    params: args.params,
    ...(args.ownerWindowId ? { ownerWindowId: args.ownerWindowId } : {}),
  });

  const sameTarget = (
    left: TaskOutputPanelParams,
    right: TaskOutputPanelParams
  ): boolean =>
    selectedTaskOutputRunId(left) === selectedTaskOutputRunId(right) &&
    left.taskId === right.taskId;

  const unsubscribeOutput = taskService.subscribeOutput((update, windowId) => {
    for (const binding of bindings.values()) {
      if (
        selectedTaskOutputRunId(binding.params) !== update.runId ||
        binding.params.taskId !== update.taskId ||
        (windowId && binding.ownerWindowId !== windowId)
      ) {
        continue;
      }
      if (!applyOutput(binding, update)) {
        bindings.delete(binding.nativePanelId);
      }
    }
  });
  const unsubscribeRuns = taskService.subscribeRuns((snapshot) => {
    for (const binding of bindings.values()) {
      const run = snapshot.runs[selectedTaskOutputRunId(binding.params)];
      if (
        run &&
        (!run.ownerWindowId || run.ownerWindowId === binding.ownerWindowId)
      ) {
        finish(binding, run);
      }
    }
  });

  return {
    attach({ browserWindowId, nativePanelId, ownerWindowId, params }) {
      const existing = bindings.get(nativePanelId);
      if (existing) {
        if (!sameTarget(existing.params, params)) {
          // Renderer reload/crash 可能发生在 native 重绑成功、dockview layout
          // 持久化之前。恢复时以已持久化的 panel params 为准重新水合，避免
          // main 内存绑定与 renderer 视图永久分裂或直接创建失败。
          if (!resetSurface(browserWindowId, nativePanelId)) {
            return { ok: false, error: "native terminal output reset failed" };
          }
          const replacement = createBinding({
            browserWindowId,
            nativePanelId,
            params,
            ...(ownerWindowId ? { ownerWindowId } : {}),
          });
          bindings.set(nativePanelId, replacement);
          if (!hydrate(replacement)) {
            if (resetSurface(existing.browserWindowId, nativePanelId)) {
              const rollback = createBinding({
                browserWindowId: existing.browserWindowId,
                nativePanelId,
                params: existing.params,
                ...(existing.ownerWindowId
                  ? { ownerWindowId: existing.ownerWindowId }
                  : {}),
              });
              bindings.set(nativePanelId, rollback);
              if (!hydrate(rollback)) {
                bindings.delete(nativePanelId);
              }
            } else {
              bindings.delete(nativePanelId);
            }
            return { ok: false, error: "native terminal rejected task output" };
          }
          return { ok: true };
        }
        if (
          taskOutputBindingGeneration(params) >=
          taskOutputBindingGeneration(existing.params)
        ) {
          existing.params = params;
        }
        return { ok: true };
      }
      const binding = createBinding({
        browserWindowId,
        nativePanelId,
        params,
        ...(ownerWindowId ? { ownerWindowId } : {}),
      });
      bindings.set(nativePanelId, binding);
      if (!hydrate(binding)) {
        bindings.delete(nativePanelId);
        return { ok: false, error: "native terminal rejected task output" };
      }
      return { ok: true };
    },
    detach(nativePanelId) {
      bindings.delete(nativePanelId);
    },
    dispose() {
      unsubscribeOutput();
      unsubscribeRuns();
      bindings.clear();
    },
    rebind({ nativePanelId, ownerWindowId, params }) {
      const existing = bindings.get(nativePanelId);
      if (!existing) {
        return { ok: false, error: "terminal output binding does not exist" };
      }
      const currentGeneration = taskOutputBindingGeneration(existing.params);
      const nextGeneration = taskOutputBindingGeneration(params);
      if (nextGeneration < currentGeneration) {
        return {
          generation: currentGeneration,
          ok: true,
          stale: true,
        };
      }
      if (sameTarget(existing.params, params)) {
        existing.params = params;
        return { generation: nextGeneration, ok: true };
      }
      if (nextGeneration === currentGeneration) {
        return {
          generation: currentGeneration,
          ok: true,
          stale: true,
        };
      }
      const cancelCloseSuppression =
        suppressNextTerminalSurfaceClose(nativePanelId);
      if (!resetSurface(existing.browserWindowId, nativePanelId)) {
        cancelCloseSuppression();
        return { ok: false, error: "native terminal output reset failed" };
      }

      const replacement = createBinding({
        browserWindowId: existing.browserWindowId,
        nativePanelId,
        params,
        ...((ownerWindowId ?? existing.ownerWindowId)
          ? { ownerWindowId: ownerWindowId ?? existing.ownerWindowId }
          : {}),
      });
      bindings.set(nativePanelId, replacement);
      if (hydrate(replacement)) {
        return { generation: nextGeneration, ok: true };
      }

      // 新输出回放失败时尽力恢复旧视图。任务已经启动，不能谎称业务回滚；
      // 这里只补偿只读 adapter，使用户仍能看到重绑前的输出。
      if (resetSurface(existing.browserWindowId, nativePanelId)) {
        const rollback = createBinding({
          browserWindowId: existing.browserWindowId,
          nativePanelId,
          params: existing.params,
          ...(existing.ownerWindowId
            ? { ownerWindowId: existing.ownerWindowId }
            : {}),
        });
        bindings.set(nativePanelId, rollback);
        hydrate(rollback);
      } else {
        bindings.delete(nativePanelId);
      }
      return { ok: false, error: "native terminal rejected task output" };
    },
    retainWindow(browserWindowId, nativePanelIds) {
      const retained = new Set(nativePanelIds);
      for (const binding of bindings.values()) {
        if (
          binding.browserWindowId === browserWindowId &&
          !retained.has(binding.nativePanelId)
        ) {
          bindings.delete(binding.nativePanelId);
        }
      }
    },
  };
}
