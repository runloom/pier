import { release } from "node:os";
import { app } from "electron";
import { disableUnusedScreenCaptureFeatures } from "./display-capture-policy.ts";

const isMac = process.platform === "darwin";

/**
 * macOS 26 (Tahoe, Darwin 25+) GPU 呈现开关。
 *
 * Electron 43.1 在交互 resize 期间整窗空白；43.4 已修空白。曾用
 * `use-angle=gl` 换更好的 resize 同步，但 ANGLE GL 在 Apple Silicon 上
 * 拖慢日常合成（文件树 hover 跟手、弹窗入场掉帧）。默认回 Metal。
 *
 * 需要对比 GL 路径时设 `PIER_USE_ANGLE_GL=1`（仍须在 app ready 前调用）。
 */
export function applyGpuWorkarounds(): void {
  // Before ready: unused ScreenCaptureKit features can prompt TCC at launch.
  disableUnusedScreenCaptureFeatures();
  if (!(isMac && Number.parseInt(release(), 10) >= 25)) {
    return;
  }
  if (process.env.PIER_USE_ANGLE_GL === "1") {
    app.commandLine.appendSwitch("use-angle", "gl");
  }
}
