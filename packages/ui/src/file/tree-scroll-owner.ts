import {
  fileTreeScrollElement,
  getAnimationFrameScheduler,
  restoreFileTreeScrollSnapshot,
} from "./tree-scroll.ts";
import type { PierFileTreeScrollSnapshot } from "./tree-types.ts";

/** Sliding window after wheel/touch/scrollbar — host must not compensate. */
export const FILE_TREE_USER_SCROLL_CLAIM_MS = 150;

/**
 * Immediate restore + optional settle frames (total writes ≤ 1 + settle).
 * Gold standard: settle defaults to 1 (≤2 frames), never multi-frame lock.
 */
export const FILE_TREE_COMPENSATE_SETTLE_FRAMES = 1;

/** Context-menu pin settle frames (microtask + rAF). */
export const FILE_TREE_MENU_PIN_SETTLE_FRAMES = 2;

/**
 * Runtime owner intents actually tracked today.
 * (`compensate` is ephemeral via generation; not stored as kind.)
 */
export type FileTreeScrollOwnerKind = "idle" | "user" | "reveal" | "menu-pin";

export interface FileTreeScrollOwner {
  abortHostScrollWrites: () => void;
  beginMenuPin: (scrollElement: HTMLElement | null | undefined) => () => void;
  beginReveal: () => void;
  claimUserScroll: () => void;
  endReveal: () => void;
  /** True while a menu pin session is active. */
  isMenuPinActive: () => boolean;
  isProgrammaticScrollEvent: (scrollElement?: HTMLElement | null) => boolean;
  /** True while reveal depth > 0 (path-sync must skip compensate). */
  isRevealActive: () => boolean;
  /** True while within the user claim window. */
  isUserScrolling: () => boolean;
  /**
   * Conditioned layout compensate: at most one restore + settle frames.
   * Aborted by user claim or reveal begin.
   */
  requestLayoutCompensate: (
    host: HTMLElement | null,
    snapshot: PierFileTreeScrollSnapshot | null,
    options?: { readonly settleFrames?: number }
  ) => void;
  /**
   * Test helper: scheduled restore with generation abort (no lock).
   * Not part of PierFileTreeScrollController public surface.
   */
  restoreSnapshotSoon: (
    host: HTMLElement | null,
    snapshot: PierFileTreeScrollSnapshot | null,
    options?: { readonly settleFrames?: number }
  ) => void;
  /**
   * Fired on every user claim (after reveal hold drop + pin abort).
   * Reveal uses this to permanently demote in-flight scroll.
   */
  subscribeUserClaim: (listener: () => void) => () => void;
  withProgrammaticScroll: (
    write: () => void,
    scrollElement?: HTMLElement | null
  ) => void;
}

export function createFileTreeScrollOwner(options?: {
  readonly now?: () => number;
  readonly schedule?: (callback: FrameRequestCallback) => number;
}): FileTreeScrollOwner {
  const now = options?.now ?? (() => Date.now());
  const schedule = options?.schedule ?? getAnimationFrameScheduler();

  let generation = 0;
  let revealDepth = 0;
  let programmaticDepth = 0;
  let pendingScrollPositions = new WeakMap<
    HTMLElement,
    { left: number; top: number }
  >();
  let userClaimUntilMs = 0;
  let menuPinActive = false;
  let endMenuPinSession: (() => void) | null = null;
  const userClaimListeners = new Set<() => void>();

  const abortHostScrollWrites = () => {
    generation += 1;
  };

  const isUserScrolling = () => now() < userClaimUntilMs;

  const isRevealActive = () => revealDepth > 0;

  const isMenuPinActive = () => menuPinActive;

  const withProgrammaticScroll = (
    write: () => void,
    scrollElement?: HTMLElement | null
  ) => {
    const previousTop = scrollElement?.scrollTop;
    const previousLeft = scrollElement?.scrollLeft;
    programmaticDepth += 1;
    try {
      write();
    } finally {
      programmaticDepth -= 1;
      // Native scroll events arrive asynchronously and may coalesce writes.
      // Match the actual resulting position instead of masking a time window.
      if (
        scrollElement &&
        (scrollElement.scrollTop !== previousTop ||
          scrollElement.scrollLeft !== previousLeft)
      ) {
        pendingScrollPositions.set(scrollElement, {
          left: scrollElement.scrollLeft,
          top: scrollElement.scrollTop,
        });
      }
    }
  };

  const isProgrammaticScrollEvent = (scrollElement?: HTMLElement | null) => {
    if (programmaticDepth > 0) {
      return true;
    }
    if (!scrollElement) {
      return false;
    }
    const position = pendingScrollPositions.get(scrollElement);
    pendingScrollPositions.delete(scrollElement);
    return (
      position !== undefined &&
      position.top === scrollElement.scrollTop &&
      position.left === scrollElement.scrollLeft
    );
  };

  const endRevealFully = () => {
    revealDepth = 0;
  };

  const stopMenuPin = () => {
    if (endMenuPinSession) {
      const end = endMenuPinSession;
      endMenuPinSession = null;
      menuPinActive = false;
      end();
    }
  };

  const claimUserScroll = () => {
    abortHostScrollWrites();
    pendingScrollPositions = new WeakMap();
    userClaimUntilMs = now() + FILE_TREE_USER_SCROLL_CLAIM_MS;
    // Design §5.3: user claim immediately ends reveal hold.
    endRevealFully();
    // user > menu-pin: abort remaining pin frames without re-applying.
    stopMenuPin();
    for (const listener of userClaimListeners) {
      listener();
    }
  };

  const beginReveal = () => {
    abortHostScrollWrites();
    revealDepth += 1;
  };

  const endReveal = () => {
    revealDepth = Math.max(0, revealDepth - 1);
  };

  const canRunCompensate = () => !(isUserScrolling() || isRevealActive());

  const runCompensate = (
    host: HTMLElement | null,
    snapshot: PierFileTreeScrollSnapshot | null,
    settleFrames: number
  ) => {
    if (snapshot === null || host === null || !canRunCompensate()) {
      return;
    }

    const runId = generation + 1;
    generation = runId;
    let remainingWrites = 1 + Math.max(0, settleFrames);

    const step = () => {
      if (generation !== runId || !canRunCompensate()) {
        return;
      }
      withProgrammaticScroll(() => {
        restoreFileTreeScrollSnapshot(host, snapshot);
      }, fileTreeScrollElement(host));
      remainingWrites -= 1;
      if (remainingWrites <= 0) {
        return;
      }
      schedule(step);
    };

    schedule(step);
  };

  const beginMenuPin = (scrollElement: HTMLElement | null | undefined) => {
    stopMenuPin();
    if (!scrollElement) {
      return () => undefined;
    }

    const pinnedTop = scrollElement.scrollTop;
    const pinGeneration = generation;
    let disposed = false;
    menuPinActive = true;

    const restore = () => {
      if (disposed || generation !== pinGeneration) {
        return;
      }
      withProgrammaticScroll(() => {
        if (Math.abs(scrollElement.scrollTop - pinnedTop) > 0.5) {
          scrollElement.scrollTop = pinnedTop;
        }
      }, scrollElement);
    };

    queueMicrotask(restore);
    let remaining = FILE_TREE_MENU_PIN_SETTLE_FRAMES;
    const tick = () => {
      if (disposed || generation !== pinGeneration) {
        return;
      }
      restore();
      remaining -= 1;
      if (remaining > 0) {
        schedule(tick);
      }
    };
    schedule(tick);

    const dispose = () => {
      if (disposed) {
        return;
      }
      // Final pin only if still same generation (user claim bumps generation).
      if (generation === pinGeneration) {
        restore();
      }
      disposed = true;
      if (endMenuPinSession === dispose) {
        endMenuPinSession = null;
        menuPinActive = false;
      }
    };
    endMenuPinSession = dispose;
    return dispose;
  };

  return {
    abortHostScrollWrites,
    beginMenuPin,
    beginReveal,
    claimUserScroll,
    endReveal,
    isMenuPinActive,
    isProgrammaticScrollEvent,
    isRevealActive,
    isUserScrolling,
    requestLayoutCompensate: (host, snapshot, compensateOptions) => {
      runCompensate(
        host,
        snapshot,
        compensateOptions?.settleFrames ?? FILE_TREE_COMPENSATE_SETTLE_FRAMES
      );
    },
    restoreSnapshotSoon: (host, snapshot, restoreOptions) => {
      runCompensate(
        host,
        snapshot,
        restoreOptions?.settleFrames ?? FILE_TREE_COMPENSATE_SETTLE_FRAMES
      );
    },
    subscribeUserClaim: (listener) => {
      userClaimListeners.add(listener);
      return () => {
        userClaimListeners.delete(listener);
      };
    },
    withProgrammaticScroll,
  };
}
