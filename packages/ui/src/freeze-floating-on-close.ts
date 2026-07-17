import { useCallback, useRef } from "react";

const POPPER_WRAPPER_SELECTOR = "[data-radix-popper-content-wrapper]";

interface FrozenFloatingStyle {
  left: string;
  top: string;
  transform: string;
  transformOrigin: string;
}

/** Survives content ref dispose/re-attach on parent re-render. */
const lastOpenByContent = new WeakMap<HTMLElement, FrozenFloatingStyle>();

function readFloatingStyle(wrapper: HTMLElement): FrozenFloatingStyle {
  return {
    left: wrapper.style.left,
    top: wrapper.style.top,
    transform: wrapper.style.transform,
    transformOrigin:
      wrapper.style.getPropertyValue("--radix-popper-transform-origin") || "",
  };
}

function writeFloatingStyle(
  wrapper: HTMLElement,
  frozen: FrozenFloatingStyle
): void {
  if (wrapper.style.left !== frozen.left) {
    wrapper.style.left = frozen.left;
  }
  if (wrapper.style.top !== frozen.top) {
    wrapper.style.top = frozen.top;
  }
  if (wrapper.style.transform !== frozen.transform) {
    wrapper.style.transform = frozen.transform;
  }
  if (frozen.transformOrigin) {
    const current = wrapper.style.getPropertyValue(
      "--radix-popper-transform-origin"
    );
    if (current !== frozen.transformOrigin) {
      wrapper.style.setProperty(
        "--radix-popper-transform-origin",
        frozen.transformOrigin
      );
    }
  }
}

function rememberOpen(content: HTMLElement, style: FrozenFloatingStyle): void {
  lastOpenByContent.set(content, style);
}

function bindFreeze(content: HTMLElement, wrapper: HTMLElement): () => void {
  const remembered = lastOpenByContent.get(content);
  let pendingOpen = remembered ?? readFloatingStyle(wrapper);
  let committedOpen = pendingOpen;
  let frozen: FrozenFloatingStyle | null = null;
  let applying = false;
  let openFrame = 0;

  if (!remembered && content.getAttribute("data-state") !== "closed") {
    rememberOpen(content, committedOpen);
  }

  const isClosed = (): boolean =>
    content.getAttribute("data-state") === "closed";

  const cancelOpenFrame = (): void => {
    if (openFrame !== 0) {
      cancelAnimationFrame(openFrame);
      openFrame = 0;
    }
  };

  const scheduleOpenCommit = (): void => {
    if (openFrame !== 0) {
      return;
    }
    openFrame = requestAnimationFrame(() => {
      openFrame = 0;
      if (!isClosed()) {
        committedOpen = pendingOpen;
        rememberOpen(content, committedOpen);
      }
    });
  };

  const applyFreeze = (): void => {
    if (!(frozen && !applying)) {
      return;
    }
    applying = true;
    try {
      writeFloatingStyle(wrapper, frozen);
    } finally {
      applying = false;
    }
  };

  const syncFromState = (): void => {
    if (isClosed()) {
      cancelOpenFrame();
      frozen = lastOpenByContent.get(content) ?? committedOpen;
      applyFreeze();
      return;
    }
    // Re-attach while still open must not replace the remembered open frame
    // with a same-turn layout-jump style write. Only styleObserver + rAF
    // commits open geometry.
    frozen = null;
  };

  const stateObserver = new MutationObserver(syncFromState);
  stateObserver.observe(content, {
    attributeFilter: ["data-state"],
    attributes: true,
  });

  const styleObserver = new MutationObserver(() => {
    if (applying) {
      return;
    }
    if (isClosed()) {
      frozen = lastOpenByContent.get(content) ?? committedOpen;
      applyFreeze();
      return;
    }
    pendingOpen = readFloatingStyle(wrapper);
    scheduleOpenCommit();
  });
  styleObserver.observe(wrapper, {
    attributeFilter: ["style"],
    attributes: true,
  });

  syncFromState();

  return () => {
    cancelOpenFrame();
    stateObserver.disconnect();
    styleObserver.disconnect();
    frozen = null;
  };
}

/**
 * Freeze Radix Popper wrapper geometry while content is `data-state=closed`.
 *
 * Presence keeps floating content mounted for exit animation. Floating UI
 * `autoUpdate` still remasures the trigger during that window; a layout
 * mutation (open panel / switch tab) can re-anchor the closing layer to
 * (0,0) for a frame. Open geometry is committed one animation frame behind
 * so same-turn layout mutations before React paints `closed` do not poison
 * the freeze snapshot. Last-open geometry is stored on a WeakMap so content
 * ref dispose/re-attach on re-render still freezes the real open position.
 */
export function freezeFloatingOnClose(content: HTMLElement): () => void {
  let disposed = false;
  let unbind: (() => void) | null = null;
  let attachFrame = 0;

  const cancelAttach = (): void => {
    if (attachFrame !== 0) {
      cancelAnimationFrame(attachFrame);
      attachFrame = 0;
    }
  };

  const attach = (): void => {
    if (disposed) {
      return;
    }
    const wrapper = content.closest(POPPER_WRAPPER_SELECTOR);
    if (wrapper instanceof HTMLElement) {
      unbind = bindFreeze(content, wrapper);
      return;
    }
    // Content ref can fire before the popper wrapper is parented in the same
    // commit; retry on the next frame.
    attachFrame = requestAnimationFrame(() => {
      attachFrame = 0;
      attach();
    });
  };

  attach();

  return () => {
    disposed = true;
    cancelAttach();
    unbind?.();
    unbind = null;
  };
}

/**
 * Callback ref that freezes floating geometry for the attached content node
 * while it is closed. Compose with other content refs.
 */
export function useFreezeFloatingOnClose(): (
  element: HTMLElement | null
) => void {
  const disposeRef = useRef<(() => void) | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  return useCallback((element: HTMLElement | null) => {
    if (element === elementRef.current) {
      return;
    }
    disposeRef.current?.();
    disposeRef.current = null;
    elementRef.current = element;
    if (element) {
      disposeRef.current = freezeFloatingOnClose(element);
    }
  }, []);
}
