export const USAGE_REFRESH_CONCURRENCY = 2;

interface UsageRefreshSchedulerOptions {
  concurrency: number;
  getAccountIds: () => string[];
  refreshAccount: (
    accountId: string,
    options: { force?: boolean }
  ) => Promise<void>;
}

export function createUsageRefreshScheduler({
  concurrency,
  getAccountIds,
  refreshAccount,
}: UsageRefreshSchedulerOptions): (options?: {
  force?: boolean;
}) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  const run = async (options: { force?: boolean }): Promise<void> => {
    const accountIds = getAccountIds();
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const accountId = accountIds[nextIndex];
        nextIndex += 1;
        if (!accountId) return;
        await refreshAccount(accountId, options);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, accountIds.length) }, () =>
        worker()
      )
    );
  };

  return (options = {}) => {
    const cycle = tail
      .catch(() => {
        // A failed cycle must not prevent later polling or manual refreshes.
      })
      .then(() => run(options));
    tail = cycle;
    return cycle;
  };
}
