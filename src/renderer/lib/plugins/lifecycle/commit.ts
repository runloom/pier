export async function commitLifecycleTransition(input: {
  finalize(outcome: "abort" | "commit"): Promise<void>;
  pluginId: string;
}): Promise<void> {
  try {
    await input.finalize("commit");
  } catch (commitError) {
    try {
      await input.finalize("abort");
    } catch (abortError) {
      throw new AggregateError(
        [commitError, abortError],
        `plugin lifecycle commit and abort compensation failed: ${input.pluginId}`
      );
    }
    throw commitError;
  }
}
