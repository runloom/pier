import { join } from "node:path";
import { isDevRuntime } from "../runtime-mode.ts";

/**
 * 字体等静态资源的物理根目录。
 *
 * 用 isDevRuntime() 而非 app.isPackaged 判 dev/prod —— pier dev 跑在
 * PierDev.app runtime 里 (见 scripts/dev-profile.mjs)，app.isPackaged 为 true，
 * 裸用会被误判成 prod、指向不存在的 process.resourcesPath/fonts。
 *
 * - dev：electron-vite dev 的 cwd 是 worktree 根 (dev-profile.mjs spawn cwd)，
 *   字体在源码 resources/fonts。
 * - prod：extraResources 把 resources/fonts 复制到 process.resourcesPath/fonts。
 */
export function assetRootDir(): string {
  return isDevRuntime()
    ? join(process.cwd(), "resources/fonts")
    : join(process.resourcesPath, "fonts");
}

/** 注册给 CoreText 的全部 ttf 绝对路径。 */
export function bundledFontPaths(): string[] {
  const root = assetRootDir();
  return [
    "JetBrainsMonoNerdFontMono-Regular.ttf",
    "JetBrainsMonoNerdFontMono-Bold.ttf",
    "JetBrainsMonoNerdFontMono-Italic.ttf",
    "JetBrainsMonoNerdFontMono-BoldItalic.ttf",
    "HarmonyOS_Sans_SC_Light.ttf",
    "HarmonyOS_Sans_SC_Regular.ttf",
    "HarmonyOS_Sans_SC_Medium.ttf",
    "HarmonyOS_Sans_SC_Bold.ttf",
  ].map((f) => join(root, f));
}
