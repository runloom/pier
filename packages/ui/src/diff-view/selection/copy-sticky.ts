/**
 * Diff 复制粘性文本（短生命周期快照，供右键菜单在 live Selection 塌掉后仍能复制）。
 *
 * 必须挂在 globalThis：Vite/Electron 可能把本模块打成两份，模块级 let 会读写
 * 到不同实例。调用约定：
 * - 写入只走 `pinDiffCopyStickyText` / `clearDiffCopyStickyText`
 * - 仅 git review diff 菜单可回退读取；其它 surface 不得用
 * - 选区折叠、纯单击正文、gutter +、组件 unmount 时必须 clear
 */
const GLOBAL_KEY = "__pierDiffCopyStickyText" as const;

type StickyGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: string;
};

function store(): StickyGlobal {
  return globalThis as StickyGlobal;
}

export function getDiffCopyStickyText(): string {
  return store()[GLOBAL_KEY] ?? "";
}

export function clearDiffCopyStickyText(): void {
  store()[GLOBAL_KEY] = "";
}

/** 非空则钉住；空串忽略（避免误清）。 */
export function pinDiffCopyStickyText(text: string): void {
  if (text.length > 0) {
    store()[GLOBAL_KEY] = text;
  }
}

/** 是否允许从 diff sticky 回退（仅 git review diff 表面）。 */
export function isDiffCopyStickySurface(surface: string | undefined): boolean {
  return surface === "git/review-diff";
}
