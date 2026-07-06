const TEST_DISABLE_QUIT_CONFIRMATION = "1";

export function shouldBypassQuitConfirmationForTests(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return (
    env.PIER_TEST_DISABLE_QUIT_CONFIRMATION ===
      TEST_DISABLE_QUIT_CONFIRMATION ||
    env.PLAYWRIGHT_TEST === TEST_DISABLE_QUIT_CONFIRMATION ||
    env.VITEST === "true"
  );
}
