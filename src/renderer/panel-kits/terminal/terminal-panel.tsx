import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";

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

/**
 * 路径 basename — POSIX 形式 (终端始终在 macOS).
 * 末尾 '/' 容错: "/" → "/"; "/a/b/" → "b"; "/a/b" → "b"; "" → "Terminal".
 */
export function basename(path: string): string {
  if (path === "" || path === "/") {
    return path === "" ? "Terminal" : "/";
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const anchorRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [sequenceTitle, setSequenceTitle] = useState<string | null>(null);

  // 订阅 swift OSC 7 → main → 这里. cwd 变化 setState 触发 descriptor 重新计算.
  // 单 listener 接所有 panel 的事件 — 按 panelId 自行过滤.
  useEffect(() => {
    const disposeCwd = window.pier.terminal.onCwdChange((event) => {
      if (event.panelId === panelId) {
        setCwd(event.cwd);
      }
    });
    // 订阅 OSC 0/2 title — TUI 应用 (claude / vim / aider) 主动设的自定义 title.
    // 退出 TUI 后 shell 通常不会"清空" title, sequenceTitle 会保留直到下一个应用
    // 写新值; 如果想"退出 claude 后 long 回到 cwd", 可以接 process-exit 事件主动
    // 清空 — v1 暂不做.
    const disposeTitle = window.pier.terminal.onTitleChange((event) => {
      if (event.panelId === panelId) {
        setSequenceTitle(event.title);
      }
    });
    return () => {
      disposeCwd();
      disposeTitle();
    };
  }, [panelId]);

  // descriptor 三字段优先级链:
  // - short: basename(cwd) — tab strip 始终显示目录, 不被 OSC 干扰 (稳定锚点)
  // - long:  sequenceTitle ?? cwd — sink 优先 OSC 自定义 ("Claude Code"),
  //          没 OSC 时 fallback cwd 完整路径
  // - path:  cwd — 真实 cwd, 不被 OSC override (breadcrumb / status bar 用)
  // 没 cwd 没 OSC 时只传 short = "Terminal".
  const descriptor = ((): {
    short: string;
    long?: string;
    path?: string;
  } => {
    const short = cwd ? basename(cwd) : "Terminal";
    const long = sequenceTitle ?? cwd ?? undefined;
    const path = cwd ?? undefined;
    const result: { short: string; long?: string; path?: string } = { short };
    if (long !== undefined) {
      result.long = long;
    }
    if (path !== undefined) {
      result.path = path;
    }
    return result;
  })();
  usePanelDescriptor(api, descriptor);

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
