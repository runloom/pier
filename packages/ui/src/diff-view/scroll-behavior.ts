export interface DiffViewScrollOptions {
  readonly behavior?: "instant" | "smooth";
  /**
   * 目标已折叠时是否展开它。默认 true（用户显式导航要看到正文）。
   *
   * 被动恢复必须传 false：它由渲染窗口上报驱动，展开会制造大幅布局变动，
   * 进而触发新的上报、再次恢复——触发信号与恢复动作互为因果。折叠全部之后
   * 后台把文件逐个弹开也直接违背用户刚表达的意图。
   */
  readonly expandCollapsed?: boolean;
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
