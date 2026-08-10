import type { WheelEvent as ReactWheelEvent } from "react";

/**
 * When a nested max-height scroller is at its vertical edge, forward the wheel
 * delta to the Markdown preview page scroller so nested scroll does not trap.
 * Shared by fenced code blocks and Mermaid diagrams.
 */
export function forwardWheelToMarkdownPreview(
  event: ReactWheelEvent<HTMLElement>
): void {
  const el = event.currentTarget;
  const { deltaY } = event;
  if (deltaY === 0) {
    return;
  }
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
    return;
  }
  const page = el.closest<HTMLElement>('[data-slot="markdown-preview"]');
  if (!page) {
    return;
  }
  page.scrollTop += deltaY;
  event.preventDefault();
}
