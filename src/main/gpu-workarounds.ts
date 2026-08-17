import { release } from "node:os";
import { app } from "electron";

const isMac = process.platform === "darwin";

/**
 * macOS 26 (Tahoe, Darwin 25+)：Chromium 默认 Metal 呈现路径在交互式窗口
 * resize 期间丢上屏——renderer 满帧产出、逐档收到新尺寸，但合成帧未随
 * AppKit resize 事务提交，整窗只显示 BaseWindow 兜底底色（Electron 43.1
 * 全程空白；43.4 修复空白但同步性仍差）。切 ANGLE GL 后端后呈现与 resize
 * 事务同步，并保留 GPU 栅格化/合成。最小复现与探针数据见 2026-08-17 调研
 * （BaseWindow/BrowserWindow、透明/不透明均可复现，与 Pier 架构无关）。
 * 上游修复后移除；若 GL 出现渲染瑕疵，备选 "disable-gpu-compositing"
 * （软件合成，同样无空白，但代价随窗口面积增长）。
 *
 * 必须在 app ready 前调用。
 */
export function applyGpuWorkarounds(): void {
  if (isMac && Number.parseInt(release(), 10) >= 25) {
    app.commandLine.appendSwitch("use-angle", "gl");
  }
}
