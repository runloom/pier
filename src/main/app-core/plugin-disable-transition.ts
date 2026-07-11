export interface PluginDisableTransitionSnapshot {
  generation: number;
  phase: "disabling" | "reloading";
  pluginId: string;
}

export interface RunPluginDisableArgs<T> {
  commit(input: { generation: number }): Promise<T>;
  finalizeWindow?(input: {
    generation: number;
    outcome: "abort" | "commit";
    transitionId: string;
    windowId: string;
  }): Promise<void>;
  isCommitted?(result: T): boolean;
  listWindowIds(): readonly string[];
  pluginId: string;
  prepareWindow(input: {
    generation: number;
    transitionId: string;
    windowId: string;
  }): Promise<void>;
  reason?: "plugin-disable" | "plugin-reload";
}

/**
 * 串行化插件停用与窗口创建。停用持有队列期间，新窗口只能排队等待；提交前
 * 重新核对存活窗口，防止未来出现绕过 WindowService 的创建入口时漏掉屏障。
 */
export class PluginDisableTransitionCoordinator {
  private readonly generations = new Map<string, number>();
  private active: PluginDisableTransitionSnapshot | null = null;
  private tail: Promise<void> = Promise.resolve();

  snapshot(): PluginDisableTransitionSnapshot | null {
    return this.active ? { ...this.active } : null;
  }

  runPluginMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(operation);
  }

  runWindowCreation<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(operation);
  }

  runDisable<T>({
    commit,
    finalizeWindow,
    isCommitted = () => true,
    listWindowIds,
    pluginId,
    reason = "plugin-disable",
    prepareWindow,
  }: RunPluginDisableArgs<T>): Promise<T> {
    return this.enqueue(async () => {
      const generation = (this.generations.get(pluginId) ?? 0) + 1;
      const transitionId = `${reason}:${pluginId}:${generation}:${randomUUID()}`;
      this.generations.set(pluginId, generation);
      this.active = {
        generation,
        phase: reason === "plugin-disable" ? "disabling" : "reloading",
        pluginId,
      };
      const preparedWindows = new Set<string>();
      let outcome: "abort" | "commit" = "abort";
      let committedResult: { value: T } | null = null;
      let finalizationError: AggregateError | null = null;
      try {
        while (true) {
          const cohort = [...new Set(listWindowIds())].filter(
            (windowId) => !preparedWindows.has(windowId)
          );
          const results = await Promise.allSettled(
            cohort.map((windowId) =>
              prepareWindow({ generation, transitionId, windowId })
            )
          );
          const liveWindowIds = new Set(listWindowIds());
          const failures: unknown[] = [];
          for (const [index, result] of results.entries()) {
            const windowId = cohort[index];
            if (!windowId) {
              continue;
            }
            if (result.status === "fulfilled") {
              if (liveWindowIds.has(windowId)) {
                preparedWindows.add(windowId);
              }
            } else if (liveWindowIds.has(windowId)) {
              failures.push(result.reason);
            }
          }
          if (failures.length > 0) {
            throw new AggregateError(
              failures,
              `plugin disable preparation failed: ${pluginId}`
            );
          }
          const unpreparedLiveWindow = [...liveWindowIds].some(
            (windowId) => !preparedWindows.has(windowId)
          );
          if (!unpreparedLiveWindow) {
            const result = await commit({ generation });
            outcome = isCommitted(result) ? "commit" : "abort";
            committedResult = { value: result };
            break;
          }
        }
      } finally {
        if (finalizeWindow) {
          const liveBeforeFinalize = new Set(listWindowIds());
          const windows = [...preparedWindows].filter((windowId) =>
            liveBeforeFinalize.has(windowId)
          );
          const results = await Promise.allSettled(
            windows.map((windowId) =>
              finalizeWindow({
                generation,
                outcome,
                transitionId,
                windowId,
              })
            )
          );
          const failures: unknown[] = [];
          const failedWindowIds: string[] = [];
          const liveAfterFinalize = new Set(listWindowIds());
          for (const [index, result] of results.entries()) {
            const windowId = windows[index];
            if (
              result.status === "rejected" &&
              windowId &&
              liveAfterFinalize.has(windowId)
            ) {
              failures.push(result.reason);
              failedWindowIds.push(windowId);
              console.error(
                "[plugin-disable-transition] finalize failed:",
                result.reason
              );
            }
          }
          if (outcome === "commit" && failedWindowIds.length > 0) {
            const recoveryWindowIds = windows.filter((windowId) =>
              liveAfterFinalize.has(windowId)
            );
            const recovery = await Promise.allSettled(
              recoveryWindowIds.map((windowId) =>
                finalizeWindow({
                  generation,
                  outcome: "abort",
                  transitionId,
                  windowId,
                })
              )
            );
            for (const result of recovery) {
              if (result.status === "rejected") {
                failures.push(result.reason);
              }
            }
            finalizationError = new AggregateError(
              failures,
              `plugin transition committed but renderer finalization failed: ${pluginId}`
            );
          } else if (outcome === "abort" && failures.length > 0) {
            finalizationError = new AggregateError(
              failures,
              `plugin transition aborted but renderer finalization failed: ${pluginId}`
            );
          }
        }
        this.active = null;
      }
      if (finalizationError) {
        throw finalizationError;
      }
      if (!committedResult) {
        throw new Error(
          `plugin transition did not produce a result: ${pluginId}`
        );
      }
      return committedResult.value;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

import { randomUUID } from "node:crypto";
