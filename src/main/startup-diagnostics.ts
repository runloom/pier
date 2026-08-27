export interface DevSingleInstanceLockFailureContext {
  profile?: string;
  rendererUrl?: string;
  userDataDir: string;
}

export interface SingleInstanceLockHost {
  exit(code: number): void;
  getPath(name: "userData"): string;
  quit(): void;
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

export function abortMissingSingleInstanceLock(
  isDev: boolean,
  host: SingleInstanceLockHost,
  logError: (message: string) => void,
  env: NodeJS.ProcessEnv = process.env
): void {
  const message = formatDevSingleInstanceLockFailure({
    userDataDir: host.getPath("userData"),
    ...(env.PIER_DEV_PROFILE ? { profile: env.PIER_DEV_PROFILE } : {}),
    ...(env.ELECTRON_RENDERER_URL
      ? { rendererUrl: env.ELECTRON_RENDERER_URL }
      : {}),
  });
  if (isDev) {
    process.stderr.write(`${message}\n`);
    logError(message);
    host.exit(1);
    return;
  }
  host.quit();
}
