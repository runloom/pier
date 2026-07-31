export interface DiffViewScrollOptions {
  readonly behavior?: "instant" | "smooth";
  readonly offset?: number;
}

/**
 * CodeView 真实滚动节点可能是 getContainerElement，也可能是带 overflow 的祖先/自身。
 * 取 scrollHeight 明显大于 clientHeight 且 scrollTop 可写的那个。
 */
export function resolveCodeViewScrollElement(
  start: HTMLElement | null | undefined
): HTMLElement | null {
  if (!start) {
    return null;
  }
  let best: HTMLElement | null = null;
  let bestSlack = 0;
  let node: HTMLElement | null = start;
  for (let depth = 0; node && depth < 6; depth += 1) {
    const slack = node.scrollHeight - node.clientHeight;
    if (slack > bestSlack) {
      best = node;
      bestSlack = slack;
    }
    node = node.parentElement;
  }
  return best ?? start;
}
