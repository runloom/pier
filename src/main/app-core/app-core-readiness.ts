export async function requireAppCoreInitialization(
  initialization: Promise<void>,
  reportFailure: (error: unknown) => void
): Promise<void> {
  try {
    await initialization;
  } catch (error) {
    reportFailure(error);
    throw error;
  }
}
