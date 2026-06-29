import { useEffect } from "react";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing.store.ts";

/**
 * 浮在终端上的 web 元素：可见期间持有一次 web 焦点请求，卸载/隐藏时释放。
 * 纯生命周期驱动，绝不由 DOM focus/blur 事件触发。
 */
export function useTerminalWebFocus(id: string, active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const release = requestTerminalWebFocus(id);
    return release;
  }, [id, active]);
}
