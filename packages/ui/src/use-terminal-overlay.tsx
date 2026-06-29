import { createContext, useCallback, useContext, useId, useRef } from "react";

/**
 * 浮在终端上的 web 浮层注册契约（IoC 接口）。
 *
 * - `registerElement(id, el)` — 注册浮层几何，用于终端鼠标命中检测。
 *   返回 `{ dispose }` 清理句柄；元素卸载时必须调用。
 * - `requestFocus(id)` — 声明键盘焦点意图（让 web 浮层持有键盘）。
 *   返回释放函数（幂等，多次调用只首次真正移除请求）。
 *
 * 由宿主应用通过 `TerminalOverlayContext.Provider` 注入具体实现；
 * 独立使用（如插件 storybook 环境）时默认降级为 noop。
 */
export interface TerminalOverlayRegistry {
  registerElement(id: string, el: HTMLElement): { dispose(): void };
  requestFocus(id: string): () => void;
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional noop
function noop() {}

/**
 * 无 Provider 时的降级实现——不注册、不持焦点、不抛错。
 * 允许 @pier/ui 组件在脱离终端上下文的环境（插件、storybook）中安全渲染。
 */
const noopRegistry: TerminalOverlayRegistry = {
  registerElement: () => ({ dispose: noop }),
  requestFocus: () => noop,
};

export const TerminalOverlayContext =
  createContext<TerminalOverlayRegistry>(noopRegistry);

/**
 * 浮在终端上的 web 浮层统一注册：几何（鼠标命中）始终注册，focus=true 时额外
 * 持一个 web 焦点请求（键盘）。返回 callback ref，挂到 Radix Content 上即可。
 * 注册对落在 web UI 上的浮层无害（那片本就是 web 区）。
 *
 * 依赖 `TerminalOverlayContext` 提供的 registry；未提供时降级为 noop。
 */
export function useTerminalOverlay({
  focus,
}: {
  focus: boolean;
}): (el: HTMLElement | null) => void {
  const registry = useContext(TerminalOverlayContext);
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
      const registration = registry.registerElement(overlayId, el);
      const releaseFocus = focus ? registry.requestFocus(overlayId) : null;
      cleanupRef.current = () => {
        registration.dispose();
        releaseFocus?.();
      };
    },
    [id, focus, registry]
  );
}
