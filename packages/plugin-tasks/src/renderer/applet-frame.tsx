import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";

export function AppletFrame({
  children,
  skeleton,
}: {
  children: ReactNode;
  skeleton: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) {
      return;
    }
    const sync = () => {
      setReady(Boolean(root.querySelector("[data-applet-ready]")));
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributeFilter: ["data-applet-ready"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    sync();
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative h-full min-h-0" ref={ref}>
      <div className="h-full min-h-0">{children}</div>
      {ready ? null : (
        <div className="absolute inset-0 bg-background">{skeleton}</div>
      )}
    </div>
  );
}
