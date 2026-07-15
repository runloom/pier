/**
 * Run an attempt once; if the result should be retried and the caller has not
 * aborted, run exactly one more attempt (cold-path recovery).
 */
export async function withOneRetry<T>(options: {
  isAborted?: () => boolean;
  run: (context: { isRetry: boolean }) => Promise<T>;
  shouldRetry: (result: T) => boolean;
}): Promise<T> {
  const first = await options.run({ isRetry: false });
  if (options.isAborted?.()) {
    return first;
  }
  if (!options.shouldRetry(first)) {
    return first;
  }
  return options.run({ isRetry: true });
}
