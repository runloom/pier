import { app } from "electron";
import {
  hydrateDevLaunchEnv,
  isPierDevShellExecutable,
} from "./dev-launch-env.ts";

export function isDevRuntime(): boolean {
  hydrateDevLaunchEnv();
  // unit 环境可能尚未 mock electron.app；缺省按「未打包」处理以免 import 图炸裂。
  const packaged = app?.isPackaged === true;
  return (
    process.env.NODE_ENV_ELECTRON_VITE === "development" ||
    !!process.env.ELECTRON_RENDERER_URL ||
    isPierDevShellExecutable(process.execPath) ||
    !packaged
  );
}
