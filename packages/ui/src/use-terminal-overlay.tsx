import { createContext, useCallback, useContext, useId, useRef } from "react";

/**
 * 浮在终端上的 web 浮层注册契约（IoC 接口）。
 *
 * - `registerElement(id, el)` — 注册浮层几何，用于终端鼠标命中检测。
 *   返回 `{ dispose }` 清理句柄；元素卸载时必须调用。
 *
 * 键盘焦点意图不在此契约内：点击打开的浮层由事件路由层的 capture 阶段
 * pointerdown 统一触发（terminal-input-routing store），键盘打开的浮层
 * （命令面板 / 设置等）各自显式调 requestTerminalWebFocus。挂载期才请求
 * 焦点重复且时序更晚，曾是"第一次点击闪关"的嫌疑路径，勿再加回。
 *
 * 由宿主应用通过 `TerminalOverlayContext.Provider` 注入具体实现；
 * 独立使用（如插件 storybook 环境）时默认降级为 noop。
 */
export interface TerminalOverlayRegistry {
  registerElement(id: string, el: HTMLElement): { dispose(): void };
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional noop
function noop() {}

/**
 * 无 Provider 时的降级实现——不注册、不抛错。
 * 允许 @pier/ui 组件在脱离终端上下文的环境（插件、storybook）中安全渲染。
 */
const noopRegistry: TerminalOverlayRegistry = {
  registerElement: () => ({ dispose: noop }),
};

export const TerminalOverlayContext =
  createContext<TerminalOverlayRegistry>(noopRegistry);

/**
 * 浮在终端上的 web 浮层几何注册（鼠标命中检测）。返回 callback ref，挂到
 * Radix Content 上即可。注册对落在 web UI 上的浮层无害（那片本就是 web 区）。
 *
 * 依赖 `TerminalOverlayContext` 提供的 registry；未提供时降级为 noop。
 */
export function useTerminalOverlay(): (el: HTMLElement | null) => void {
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
      cleanupRef.current = () => {
        registration.dispose();
      };
    },
    [id, registry]
  );
}
