import { registerTerminalElementWebOverlay } from "@/stores/terminal-input-routing-slice.ts";
import {
  createDomOverlayReconciler,
  type ReconciledOverlayEntry,
} from "./overlays/reconciler.ts";

/**
 * dockview 拖拽落点浮层的 native 半透明登记。
 *
 * 落点层是半透明高亮：终端 panel 的 content 区正好是 native 洞遮罩挖出的洞。
 * 若把 `.dv-drop-target-anchor` 当普通 paint overlay 回填，web backing 不透明，
 * 终端会被整块兜底色替换——看起来是预览层，实际终端内容消失。这里改走
 * `scrim + scrimBorder`：web anchor 仍负责非终端表面，native 在洞里画同色
 * 半透明填充与描边，终端内容继续透出来。
 *
 * 生命周期：workspace host 在 `onReady` 挂载，随 workspace runtime 一起 dispose。
 * 几何：dockview 每次 dragover 都会改 anchor inline style；尺寸变化走
 * ResizeObserver，位置变化盯 style，top/left/width/height 的 CSS transition
 * 再按 rAF 跟帧，避免 native 蒙层停在过渡起点。
 */

const DROP_ANCHOR_SELECTOR = ".dv-drop-target-container .dv-drop-target-anchor";
const GEOMETRY_TRANSITION_PROPERTIES = new Set([
  "top",
  "left",
  "width",
  "height",
]);

interface CssTransitionLike extends Animation {
  transitionProperty?: string;
}

interface DropOverlayEntry extends ReconciledOverlayEntry {
  anchor: HTMLElement;
  onTransitionStart: () => void;
  transitionFrame: number | null;
}

function hasRunningGeometryTransition(element: HTMLElement): boolean {
  const animations = element.getAnimations?.() ?? [];
  return animations.some((animation) => {
    if (animation.playState !== "running") {
      return false;
    }
    const property = (animation as CssTransitionLike).transitionProperty;
    return (
      property !== undefined && GEOMETRY_TRANSITION_PROPERTIES.has(property)
    );
  });
}

export function attachWorkspaceDropOverlayWebOverlays(
  root: HTMLElement
): () => void {
  let nextSequence = 1;
  let disposed = false;

  const followGeometry = (entry: DropOverlayEntry): void => {
    entry.transitionFrame = null;
    if (disposed || !entry.anchor.isConnected) {
      return;
    }
    entry.registration.flush();
    if (hasRunningGeometryTransition(entry.anchor)) {
      entry.transitionFrame = requestAnimationFrame(() =>
        followGeometry(entry)
      );
    }
  };

  const scheduleTransitionFollow = (entry: DropOverlayEntry): void => {
    if (entry.transitionFrame !== null) {
      return;
    }
    entry.transitionFrame = requestAnimationFrame(() => followGeometry(entry));
  };

  const reconciler = createDomOverlayReconciler<HTMLElement>({
    collect: () => root.querySelectorAll<HTMLElement>(DROP_ANCHOR_SELECTOR),
    disposeOnRootMutation: (anchor) => !anchor.isConnected,
    register: (anchor, schedule) => {
      const registration = registerTerminalElementWebOverlay(
        `dockview-drop-overlay:${nextSequence}`,
        anchor,
        { scrim: true, scrimBorder: true }
      );
      nextSequence += 1;
      const entry: DropOverlayEntry = {
        anchor,
        observer: new MutationObserver(schedule),
        onTransitionStart: () => undefined,
        registration,
        transitionFrame: null,
      };
      entry.onTransitionStart = () => scheduleTransitionFollow(entry);
      entry.dispose = () => {
        anchor.removeEventListener("transitionstart", entry.onTransitionStart);
        if (entry.transitionFrame !== null) {
          cancelAnimationFrame(entry.transitionFrame);
          entry.transitionFrame = null;
        }
      };
      // 位置由 dockview 写 inline style；尺寸不变时 ResizeObserver 不触发。
      entry.observer.observe(anchor, {
        attributeFilter: ["style", "class"],
        attributes: true,
      });
      anchor.addEventListener("transitionstart", entry.onTransitionStart);
      return entry;
    },
    root,
  });

  return () => {
    disposed = true;
    reconciler.dispose();
  };
}
