import { useCallback, useId, useRef } from "react";
import {
  registerTerminalElementWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";

/**
 * 浮在终端上的 web 浮层统一注册：几何（鼠标命中）始终注册，focus=true 时额外
 * 持一个 web 焦点请求（键盘）。返回 callback ref，挂到 Radix Content 上即可。
 * 注册对落在 web UI 上的浮层无害（那片本就是 web 区）。
 */
export function useTerminalOverlay({
  focus,
}: {
  focus: boolean;
}): (el: HTMLElement | null) => void {
  const id = useId();
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (!el) {
        return;
      }
      const overlayId = `terminal-overlay:${id}`;
      const registration = registerTerminalElementWebOverlay(overlayId, el);
      const releaseFocus = focus ? requestTerminalWebFocus(overlayId) : null;
      cleanupRef.current = () => {
        registration.dispose();
        releaseFocus?.();
      };
    },
    [id, focus]
  );
}
