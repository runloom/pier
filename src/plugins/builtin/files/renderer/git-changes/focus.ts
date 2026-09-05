// Radix dispatches this event on the retained content element from its actual
// FocusScope unmount timer, then restores focus before returning from dispatch.
const RESTORE_FOCUS_EVENT = "focusScope.autoFocusOnUnmount";

/** A closing command palette restores focus after its exit animation. */
export function focusAfterClosingDialog(
  getTarget: () => HTMLElement | null,
  setHandoff: (active: boolean) => void
): () => void {
  const closing = [
    ...document.querySelectorAll(
      '[data-slot="dialog-content"][data-state="closed"]'
    ),
  ];
  if (!closing.length) return () => {};
  setHandoff(true);
  let cancelled = false;
  const pending = new Set(closing);
  const restored = (event: Event) => {
    pending.delete(event.currentTarget as Element);
    // Wait for the native restoration and FocusScope stack update to finish.
    // An animation frame can run before that timer and is not a completion signal.
    queueMicrotask(() => {
      if (cancelled || pending.size) return;
      getTarget()?.focus({ preventScroll: true });
      setHandoff(false);
    });
  };
  for (const node of closing)
    node.addEventListener(RESTORE_FOCUS_EVENT, restored, { once: true });
  return () => {
    cancelled = true;
    for (const node of closing)
      node.removeEventListener(RESTORE_FOCUS_EVENT, restored);
    setHandoff(false);
  };
}
