/** 模型层输入信号的整形。 */

import { MAX_REFINE_CHANGED_FILES } from "./constants.ts";

/**
 * git 路径 → 去重 basename，裁到上限。
 * 只给文件名不给全路径：目录层级对「这个会话在干什么」几乎没有说明力，
 * 却会占掉提示词预算，还把本机绝对路径带进调用。
 */
export function titleChangedFileNames(paths: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const name = path.split("/").filter(Boolean).at(-1);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
    if (names.length >= MAX_REFINE_CHANGED_FILES) {
      break;
    }
  }
  return names;
}
