// pierre/trees 的 onOpenPath 每次点击都触发,但同一 treeitem 二次点击是否重发
// 取决于 tree 内部选中态实现,组件测试里 fireEvent.click 二次不一定 fire。
// 把双击判定抽成 pure function 单测,file-tree-sidebar 里持有一个 ref 记录
// 最近一次 openPath 的 (path, timestamp),交给这里判断"是否命中窗口"。

export interface DoubleClickTrack {
  readonly path: string;
  readonly timestamp: number;
}

export interface DoubleClickResult {
  readonly isDouble: boolean;
  // 命中双击后返回 null 清空 track,防止连续三次点击又误判成新的"双击起点"。
  // 未命中则返回本次 (path, timestamp) 作为下次判定的基准。
  readonly nextTrack: DoubleClickTrack | null;
}

export function detectDoubleClick(
  path: string,
  now: number,
  last: DoubleClickTrack | null,
  windowMs: number
): DoubleClickResult {
  const isDouble =
    last !== null && last.path === path && now - last.timestamp < windowMs;
  return {
    isDouble,
    nextTrack: isDouble ? null : { path, timestamp: now },
  };
}
