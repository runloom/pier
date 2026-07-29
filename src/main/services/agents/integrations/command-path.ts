import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * PATH 扫描探测二进制是否存在（loomdesk commandExists 同款, 集成 detect()
 * 的兜底手段）。仅安装/卸载时调用, 频率极低。
 */
export function commandExistsOnPath(command: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, command))) {
      return true;
    }
  }
  return false;
}
