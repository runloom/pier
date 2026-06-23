import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";

function getAnchorFrame(anchor: HTMLDivElement): TerminalFrame | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) {
    return null;
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function waitForRealSize(anchor: HTMLDivElement): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const r = anchor.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const anchorRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const parent = parentRef.current?.parentElement;
    const anchor = anchorRef.current;
    if (!(parent && anchor)) {
      return;
    }

    const sync = () => {
      anchor.style.width = `${parent.clientWidth}px`;
      anchor.style.height = `${parent.clientHeight}px`;
    };
    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    let disposed = false;
    const subscriptions: Array<{ dispose(): void }> = [];
    let lastFrame = "";

    const sendFrameNow = () => {
      if (disposed) {
        return;
      }
      const frame = getAnchorFrame(anchor);
      if (!frame) {
        return;
      }
      const key = `${frame.x},${frame.y},${frame.width},${frame.height}`;
      if (key === lastFrame) {
        return;
      }
      lastFrame = key;
      window.pier.terminal.setFrame(panelId, frame);
    };

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        sendFrameNow();
      });
    };

    const init = async () => {
      await waitForRealSize(anchor);
      if (disposed) {
        return;
      }

      const frame = getAnchorFrame(anchor);
      if (!frame) {
        setError("无法获取面板坐标");
        return;
      }

      const result = await window.pier.terminal.create({ panelId, frame });
      if (!result.ok) {
        setError(result.error ?? "终端创建失败");
        return;
      }

      subscriptions.push(
        api.onDidVisibilityChange((e) => {
          if (e.isVisible) {
            lastFrame = ""; // 强制重发 frame, 终端可能在 offscreen
            sendFrameNow();
            window.pier.terminal.show(panelId);
          } else {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!disposed) {
                  window.pier.terminal.hide(panelId);
                }
              });
            });
          }
        })
      );

      subscriptions.push(
        api.onDidActiveChange((e) => {
          if (e.isActive) {
            window.pier.terminal.focus(panelId);
          }
        })
      );

      const parent = anchor.parentElement;
      if (parent) {
        const ro = new ResizeObserver(scheduleSync);
        ro.observe(parent);
        subscriptions.push({ dispose: () => ro.disconnect() });
      }

      const onWindowResize = () => sendFrameNow();
      window.addEventListener("resize", onWindowResize);
      subscriptions.push({
        dispose: () => window.removeEventListener("resize", onWindowResize),
      });
    };

    init();

    return () => {
      disposed = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      for (const s of subscriptions) {
        s.dispose();
      }
      window.pier.terminal.close(panelId);
    };
  }, [api, panelId]);

  // 订阅 swift 转发的右键: panel 的 NSView 吞掉 React 层 onContextMenu, 唯一拿到
  // 右键的方式是 swift NSEvent monitor 拦截 + IPC 转发. 这里按 panelId 过滤 (一个
  // terminal panel 的菜单只该响应它自己的右键).
  useEffect(() => {
    const unsubscribe = window.pier?.terminal?.onContextMenuRequest?.((req) => {
      if (req.panelId !== panelId) {
        return;
      }
      popupContextMenuAt("terminal/content", { x: req.x, y: req.y }).catch(
        (err: unknown) => {
          console.error(`[terminal-panel] popup ${req.panelId} failed:`, err);
        }
      );
    });
    return () => {
      unsubscribe?.();
    };
  }, [panelId]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full" ref={parentRef}>
      <div className="terminal-anchor" ref={anchorRef} />
    </div>
  );
}
