import { join } from "node:path";
import { app } from "electron";

/** 字体等静态资源的物理根目录。dev 用项目内 resources/，prod 用 process.resourcesPath。 */
export function assetRootDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "fonts")
    : join(app.getAppPath(), "resources/fonts");
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
