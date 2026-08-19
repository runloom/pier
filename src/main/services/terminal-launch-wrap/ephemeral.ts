export const HOST_PANEL_IDENTITY_ENV_KEYS = [
  "PIER_CONTROL_SOCKET",
  "PIER_PANEL_ID",
  "PIER_WINDOW_ID",
] as const;

const IDENTITY_KEY_SET = new Set<string>(HOST_PANEL_IDENTITY_ENV_KEYS);

export function isHostPanelIdentityEnvKey(key: string): boolean {
  return IDENTITY_KEY_SET.has(key);
}

export function stripEphemeralEnvKeys(
  env: Record<string, string>,
  decorateSpawnKeys: readonly string[] = []
): Record<string, string> {
  const drop = new Set<string>([
    ...HOST_PANEL_IDENTITY_ENV_KEYS,
    ...decorateSpawnKeys,
  ]);
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !drop.has(key))
  );
}
