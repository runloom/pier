export interface DevSingleInstanceLockFailureContext {
  profile?: string;
  rendererUrl?: string;
  userDataDir: string;
}

export function formatDevSingleInstanceLockFailure({
  profile,
  rendererUrl,
  userDataDir,
}: DevSingleInstanceLockFailureContext): string {
  return [
    "[startup] another Pier instance already owns this dev profile.",
    profile ? `  profile: ${profile}` : null,
    rendererUrl ? `  renderer: ${rendererUrl}` : null,
    `  userData: ${userDataDir}`,
    "  Stop the existing Pier/Electron process, or use a different PIER_DEV_PROFILE/ELECTRON_USER_DATA_DIR.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
