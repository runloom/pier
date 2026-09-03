import { app } from "electron";
import {
  hydrateDevLaunchEnv,
  isPierDevShellExecutable,
} from "./dev-launch-env.ts";

function isElectronAppPackaged(): boolean {
  try {
    // unit 环境可能尚未 mock electron.app；缺省按「未打包」处理以免 import 图炸裂。
    // Vitest 对未声明的 named export 会 throw，不能只靠 optional chaining。
    return app?.isPackaged === true;
  } catch {
    return false;
  }
}

export function isDevRuntime(): boolean {
  hydrateDevLaunchEnv();
  return (
    process.env.NODE_ENV_ELECTRON_VITE === "development" ||
    !!process.env.ELECTRON_RENDERER_URL ||
    isPierDevShellExecutable(process.execPath) ||
    !isElectronAppPackaged()
  );
}
