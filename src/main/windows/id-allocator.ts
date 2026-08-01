/**
 * Window ID allocator — 分配 w-{N} 格式的唯一窗口 ID.
 *
 * seed() 用已持久化的 ID 初始化 used 集合, next() 找最小可用序号, release() 回收.
 */
const W_ID_RE = /^w-(\d+)$/;

function parseWindowNum(id: string): number | null {
  const m = W_ID_RE.exec(id);
  if (!m) {
    return null;
  }
  return Number.parseInt(m[1] ?? "", 10);
}

export class WindowIdAllocator {
  private readonly used = new Set<number>();

  seed(existingIds: readonly string[]): void {
    this.used.clear();
    for (const id of existingIds) {
      const n = parseWindowNum(id);
      if (n !== null) {
        this.used.add(n);
      }
    }
  }

  next(): string {
    let n = 1;
    while (this.used.has(n)) {
      n++;
    }
    this.used.add(n);
    return `w-${n}`;
  }

  release(id: string): void {
    const n = parseWindowNum(id);
    if (n !== null) {
      this.used.delete(n);
    }
  }
}
