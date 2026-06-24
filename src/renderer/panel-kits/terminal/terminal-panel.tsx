import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useRef, useState } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelEventState } from "@/hooks/use-panel-event-state.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { computeMonoFontFamily, useFontStore } from "@/stores/font.store.ts";

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
  const monoFontFamily = useFontStore((s) => s.monoFontFamily);
  const monoFontSize = useFontStore((s) => s.monoFontSize);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // 订阅 swift OSC 7 → main → 这里. usePanelEventState 自动按 panelId 过滤 +
  // 空字符串忽略 (vim set notitle / tmux detach 等清空场景不污染上一次有效值).
  const cwd = usePanelEventState(
    window.pier.terminal.onCwdChange,
    panelId,
    (e) => e.cwd
  );
  const sequenceTitle = usePanelEventState(
    window.pier.terminal.onTitleChange,
    panelId,
    (e) => e.title
  );

  // descriptor 三字段优先级链:
  // - short: basename(cwd) — tab strip 始终显示目录, 不被 OSC 干扰 (稳定锚点)
  // - long:  sequenceTitle ?? cwd — sink 优先 OSC 自定义 ("Claude Code"),
  //          没 OSC 时 fallback cwd 完整路径
  // - path:  cwd — 真实 cwd, 不被 OSC override (breadcrumb / status bar 用)
  // hook input 接受 undefined; hook 内部按字段存在性条件 upsert 到 store.
  usePanelDescriptor(api, {
    short: cwd ? basename(cwd) : "Terminal",
    long: sequenceTitle ?? cwd ?? undefined,
    path: cwd ?? undefined,
  });

  const monoFontFamilyRef = useRef(monoFontFamily);
  const monoFontSizeRef = useRef(monoFontSize);
  monoFontFamilyRef.current = monoFontFamily;
  monoFontSizeRef.current = monoFontSize;

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

      const result = await window.pier.terminal.create({
        panelId,
        frame,
        font: {
          family: computeMonoFontFamily(monoFontFamilyRef.current),
          size: monoFontSizeRef.current,
        },
      });
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

      subscriptions.push(api.onDidDimensionsChange(sendFrameNow));

      const onWindowResize = () => sendFrameNow();
      window.addEventListener("resize", onWindowResize);
      subscriptions.push({
        dispose: () => window.removeEventListener("resize", onWindowResize),
      });
    };

    init();

    return () => {
      disposed = true;
      for (const s of subscriptions) {
        s.dispose();
      }
    };
  }, [api, panelId]);

  useEffect(() => {
    window.pier.terminal.setFont(panelId, {
      family: computeMonoFontFamily(monoFontFamily),
      size: monoFontSize,
    });
  }, [panelId, monoFontFamily, monoFontSize]);

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
    <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div className="terminal-anchor absolute inset-0" ref={anchorRef} />
    </div>
  );
}
