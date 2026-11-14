import {
  paintedChildOf,
  useTerminalOverlayRegistration,
} from "@pier/ui/use-terminal-overlay.tsx";
import { type ReactNode, useCallback, useRef } from "react";

export function TerminalFloatingStaticItem({
  children,
  id,
  panelId,
  setElement,
}: {
  children: ReactNode;
  id: string;
  panelId: string;
  setElement(id: string, element: HTMLElement | null): void;
}) {
  // 槽位外壳只负责布局：透明、直角、无阴影。圆角 / 阴影 / 背景由子元素绘制，
  // 外观必须读子元素，否则 native 洞回填按直角切角、阴影恒为空。
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appearanceElement = useCallback(
    () => paintedChildOf(hostRef.current),
    []
  );
  const overlay = useTerminalOverlayRegistration(
    `terminal-floating:${panelId}:${id}`,
    { appearanceElement }
  );
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      hostRef.current = element;
      overlay.ref(element);
      setElement(id, element);
    },
    [id, overlay, setElement]
  );
  return (
    <div className="pointer-events-auto" data-floating-item={id} ref={ref}>
      {children}
    </div>
  );
}
