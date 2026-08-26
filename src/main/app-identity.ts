import { join } from "node:path";
import { app } from "electron";
import { hydrateDevLaunchEnv } from "./dev-launch-env.ts";

const DEV_USER_DATA_ROOT = "Pier-dev";
const USER_DATA_DIR_FLAG = "--user-data-dir";

function userDataDirFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg?.startsWith(`${USER_DATA_DIR_FLAG}=`)) {
      return arg.slice(`${USER_DATA_DIR_FLAG}=`.length);
    }
    if (arg === USER_DATA_DIR_FLAG) {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        return next;
      }
    }
  }
}

function devUserDataDirForCwd(cwd: string): string {
  return join(cwd, `.${DEV_USER_DATA_ROOT.toLowerCase()}`, "userData");
}

export function resolveMainUserDataDir(options: {
  argv?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  isDev: boolean;
}): string | undefined {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const cwd = options.cwd ?? process.cwd();
  return (
    env.ELECTRON_USER_DATA_DIR ??
    userDataDirFromArgv(argv) ??
    (options.isDev ? devUserDataDirForCwd(cwd) : undefined)
  );
}

export function configureMainAppIdentity(isDev: boolean): void {
  hydrateDevLaunchEnv();
  // dev 的 Vite HMR 需要 unsafe-eval，因此关闭 Electron 的对应安全警告。
  if (isDev) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  }
  // setName() overrides name-derived paths (including userData) when called
  // before ready. Pin the profile directory after setName so `pnpm dev` does
  // not inherit ~/Library/Application Support/Pier and collide with the
  // installed app's single-instance lock.
  app.setName("Pier");
  const userDataDir = resolveMainUserDataDir({ isDev });
  if (userDataDir) {
    app.setPath("userData", userDataDir);
  }
}
