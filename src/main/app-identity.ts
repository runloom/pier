import { join } from "node:path";
import { app } from "electron";

const DEV_USER_DATA_ROOT = "Pier-dev";

function hasExplicitUserDataDir(argv: readonly string[]): boolean {
  return argv.some(
    (arg) => arg === "--user-data-dir" || arg.startsWith("--user-data-dir=")
  );
}

function devUserDataDirForCwd(cwd: string): string {
  return join(cwd, `.${DEV_USER_DATA_ROOT.toLowerCase()}`, "userData");
}

function setUserDataPath(userDataDir: string): void {
  if (hasExplicitUserDataDir(process.argv)) return;
  app.setPath("userData", userDataDir);
}

export function configureMainAppIdentity(isDev: boolean): void {
  // dev 的 Vite HMR 需要 unsafe-eval，因此关闭 Electron 的对应安全警告。
  if (isDev) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
    const cwd = process.cwd();
    setUserDataPath(
      process.env.ELECTRON_USER_DATA_DIR ?? devUserDataDirForCwd(cwd)
    );
  }
  app.setName("Pier");
}
