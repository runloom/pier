import { useTerminalOverlayRegistration } from "@pier/ui/use-terminal-overlay.tsx";
import { type ReactNode, useCallback } from "react";

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
  const overlay = useTerminalOverlayRegistration(
    `terminal-floating:${panelId}:${id}`
  );
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
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
