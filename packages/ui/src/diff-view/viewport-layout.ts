export function waitForStableViewportLayout(
  readLayoutKey: () => string | null,
  stableFrames: number,
  callback: () => void
): () => void {
  let cancelled = false;
  let frame: number | null = null;
  let previousLayoutKey: string | null = null;
  let stableFrameCount = 0;
  const check = (): void => {
    if (cancelled) {
      return;
    }
    const layoutKey = readLayoutKey();
    if (layoutKey === previousLayoutKey) {
      stableFrameCount += 1;
    } else {
      previousLayoutKey = layoutKey;
      stableFrameCount = 1;
    }
    if (stableFrameCount >= Math.max(1, stableFrames)) {
      callback();
      return;
    }
    frame = requestAnimationFrame(check);
  };
  frame = requestAnimationFrame(check);
  return () => {
    cancelled = true;
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
  };
}
