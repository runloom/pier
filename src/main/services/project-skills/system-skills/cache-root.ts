import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 系统技能缓存根(进程级单槽,对齐 peer-identity 的宿主注册先例)。
 *
 * 项目内发现软链(`.agents/skills/<id>` 等)指向此处的**绝对路径**,由外部
 * 智能体进程解析,必须跨 build 稳定——userData 含 build 名(Pier / Pier-dev),
 * 换 build 即悬空。组合根注入 `~/.pier/system-skills`;未注入时回退旧
 * userData 公式,保证单测天然隔离。
 */
let hostCacheRoot: string | null = null;

export function setSystemSkillsCacheRootForHost(root: string): void {
  hostCacheRoot = root;
}

export function resetSystemSkillsCacheRootForTests(): void {
  hostCacheRoot = null;
}

export function systemSkillsCacheRoot(userData: string): string {
  return hostCacheRoot ?? join(userData, "skills", ".system");
}

/**
 * 存量迁移(一次性):缓存根从 `{userData}/skills/.system` 整目录搬到
 * `~/.pier/system-skills`(含 `<id>/` 与 `<id>.marker`)。目标已存在或旧根
 * 不存在则不动;项目内旧软链由技能收敛按账本 owned 判定自愈重链。
 */
export function migrateLegacySystemSkillsCacheRoot(
  legacyRoot: string,
  root: string
): void {
  if (existsSync(root) || !existsSync(legacyRoot)) {
    return;
  }
  mkdirSync(dirname(root), { recursive: true });
  renameSync(legacyRoot, root);
}
