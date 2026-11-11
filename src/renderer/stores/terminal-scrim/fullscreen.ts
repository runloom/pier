import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/viewport.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

interface WebOverlayRegistration {
  dispose(): void;
  flush(): void;
}

type SetWebOverlayRect = (
  id: string,
  frame: TerminalFrame | null,
  paints?: boolean
) => void;

let setWebOverlayRect: SetWebOverlayRect | null = null;

/** 由 input-routing slice 在模块初始化时绑定，避免和矩形表循环引用。 */
export function bindTerminalWebOverlayRect(set: SetWebOverlayRect): void {
  setWebOverlayRect = set;
}

function overlayRect(
  id: string,
  frame: TerminalFrame | null,
  paints?: boolean
): void {
  if (!setWebOverlayRect) {
    throw new Error("terminal web overlay rect setter is not bound");
  }
  setWebOverlayRect(id, frame, paints);
}

export function registerTerminalFullscreenWebOverlay(
  id: string
): WebOverlayRegistration {
  let frameRequest: number | null = null;

  // 全屏输入捕获层本身不画像素：只进事件路由，不参与 native 洞遮罩回填。
  // 若把整窗矩形当 web 可绘制区，洞会被全部抹掉；不透明 backing 下终端
  // 会整块消失（2026-11-09 sash 拖拽复现）。真正绘制的浮层内容
  // （菜单 / popover / toast）各自用 registerTerminalElementWebOverlay 登记。
  const flush = () => {
    overlayRect(id, readTerminalViewportFrame(), false);
  };

  const flushTrailing = () => {
    flush();
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
    }
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null;
      flush();
    });
  };

  const onWindowLayoutPulse = (pulse: WindowLayoutPulse) => {
    if (
      pulse.reason === "view-zoom" &&
      typeof pulse.windowZoomLevel === "number"
    ) {
      useZoomStore.setState({ windowZoomLevel: pulse.windowZoomLevel });
    }
    flushTrailing();
  };

  window.addEventListener("resize", flushTrailing);
  const disposePulse =
    window.pier?.window?.onLayoutPulse?.(onWindowLayoutPulse) ?? null;
  flushTrailing();

  return {
    dispose() {
      if (frameRequest !== null) {
        cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      window.removeEventListener("resize", flushTrailing);
      disposePulse?.();
      overlayRect(id, null);
    },
    flush,
  };
}
