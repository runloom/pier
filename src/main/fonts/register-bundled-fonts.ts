import { loadNativeAddon } from "../ipc/terminal-native-addon.ts";
import { bundledFontPaths } from "./asset-paths.ts";

/** 启动时把打包字体注册给 CoreText。必须在创建任何 terminal 之前调用。 */
export function registerBundledFonts(): void {
  const { addon, error } = loadNativeAddon();
  if (!addon) {
    console.warn("[fonts] addon 未加载，跳过字体注册:", error);
    return;
  }
  try {
    addon.registerFonts(bundledFontPaths());
  } catch (err) {
    console.error("[fonts] registerFonts 失败:", err);
  }
}
