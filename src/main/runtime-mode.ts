import { app } from "electron";

export function isDevRuntime(): boolean {
  return (
    process.env.NODE_ENV_ELECTRON_VITE === "development" ||
    !!process.env.ELECTRON_RENDERER_URL ||
    !app.isPackaged
  );
}
