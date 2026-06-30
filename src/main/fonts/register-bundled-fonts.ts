import { loadNativeAddon } from "../ipc/terminal-native-addon.ts";
import { bundledFontPaths } from "./asset-paths.ts";

/** 启动时把打包字体注册给 CoreText。必须在创建任何 terminal 之前调用。 */
export function registerBundledFonts(): void {
  const { addon, error } = loadNativeAddon();
  if (!addon) {
    console.warn(
      "[fonts] 字体未注册给 CoreText, 终端中文可能回退系统字体: addon 未加载",
      error
    );
    return;
  }
  try {
    addon.registerFonts(bundledFontPaths());
  } catch (err) {
    console.warn(
      "[fonts] 字体未注册给 CoreText, 终端中文可能回退系统字体: registerFonts 失败",
      err
    );
  }
}
