export async function waitForSettledWithAbort(
  operations: Iterable<Promise<unknown>>,
  signal: AbortSignal,
  abortMessage: string
): Promise<void> {
  if (signal.aborted) {
    throw new DOMException(abortMessage, "AbortError");
  }
  const settled = Promise.allSettled([...operations]);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException(abortMessage, "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    settled.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}
