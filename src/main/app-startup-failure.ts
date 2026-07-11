export interface MainStartupFailureTask {
  label: string;
  run(): Promise<void> | void;
}

interface MainStartupFailureDependencies {
  cleanupTasks: readonly MainStartupFailureTask[];
  cleanupTimeoutMs?: number;
  error: unknown;
  exit(code: number): void;
  isChinese: boolean;
  log(message: string, error: unknown): void;
  showError(title: string, body: string): void;
}

const DEFAULT_STARTUP_CLEANUP_TIMEOUT_MS = 5000;

function formatStartupFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines = [error.stack ?? `${error.name}: ${error.message}`];
  if (error instanceof AggregateError) {
    for (const item of error.errors) {
      lines.push(item instanceof Error ? item.message : String(item));
    }
  }
  return lines.join("\n").slice(0, 20_000);
}

/** 主进程启动失败时给出唯一可见反馈，尝试全部清理后确定退出。 */
export async function handleMainStartupFailure(
  dependencies: MainStartupFailureDependencies
): Promise<void> {
  const {
    cleanupTasks,
    cleanupTimeoutMs = DEFAULT_STARTUP_CLEANUP_TIMEOUT_MS,
    error,
    exit,
    isChinese,
    log,
    showError,
  } = dependencies;
  log("main startup failed", error);
  try {
    showError(
      isChinese ? "Pier 启动失败" : "Pier failed to start",
      formatStartupFailure(error)
    );
  } catch (feedbackError) {
    log("failed to show main startup error", feedbackError);
  }
  const pending = new Set(cleanupTasks.map((task) => task.label));
  const cleanup = Promise.all(
    cleanupTasks.map(async (task) => {
      try {
        await task.run();
        return { label: task.label } as const;
      } catch (cleanupError) {
        return { error: cleanupError, label: task.label } as const;
      } finally {
        pending.delete(task.label);
      }
    })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    cleanup.then((results) => ({ results, timedOut: false as const })),
    new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), cleanupTimeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (outcome.timedOut) {
    for (const label of pending) {
      log(
        `main startup cleanup timed out: ${label}`,
        new Error(`cleanup exceeded ${cleanupTimeoutMs}ms`)
      );
    }
  } else {
    for (const result of outcome.results) {
      if ("error" in result) {
        log(`main startup cleanup failed: ${result.label}`, result.error);
      }
    }
  }
  exit(1);
}
