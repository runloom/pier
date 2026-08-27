/**
 * 字体栈金标准治理 —— 锁定 2026-08-23「系统字体优先」终态：
 *
 * 1. UI 字体链系统字体优先（system-ui 在最前，对齐 VS Code / Linear）：
 *    macOS 由 SF Pro + PingFang SC 承接，600 字重是真 Semibold；
 *    不打包任何 CJK UI 字体（历史包袱 HarmonyOS Sans SC 已删除，-31MB）。
 * 2. CJK 段走 globals.css 的 --pier-cjk-font-family，经 :root:lang(ja|ko)
 *    随界面语言切换（zh → PingFang SC，ja → Hiragino Sans，ko → Apple SD Gothic Neo），
 *    避免日韩文本被 SC 字形渲染；font.store 只持有 var() 引用，不写死字体名。
 * 3. 终端 (ghostty/CoreText) 链只用真实字体名（无 CSS generic / var()），
 *    CJK 由系统 PingFang SC 承接。
 * 4. resources/fonts 只保留 JetBrains Mono Nerd Font（终端/图标必需，非系统字体）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const FONTS_DIR = join(REPO_ROOT, "resources/fonts");

const GLOBALS_CSS = readFileSync(
  join(REPO_ROOT, "src/renderer/app/globals.css"),
  "utf8"
);
const FONTS_TS = readFileSync(
  join(REPO_ROOT, "src/renderer/app/fonts.ts"),
  "utf8"
);
const FONT_STORE = readFileSync(
  join(REPO_ROOT, "src/renderer/stores/font.store.ts"),
  "utf8"
);
const ASSET_PATHS = readFileSync(
  join(REPO_ROOT, "src/main/fonts/asset-paths.ts"),
  "utf8"
);

describe("font stack governance (system-first, no bundled CJK)", () => {
  it("resources/fonts 不含 HarmonyOS，只保留 JetBrains Mono Nerd Font", () => {
    const files = readdirSync(FONTS_DIR);
    expect(files.some((f) => /harmony/i.test(f))).toBe(false);
    const ttf = files.filter((f) => f.endsWith(".ttf"));
    expect(ttf.length).toBe(4);
    for (const f of ttf) {
      expect(f.startsWith("JetBrainsMonoNerdFontMono-")).toBe(true);
    }
  });

  it("打包 @font-face 不含 CJK UI 字体", () => {
    expect(FONTS_TS).not.toContain("HarmonyOS");
    expect(FONTS_TS).toContain("JetBrainsMonoNerdFontMono-Regular.ttf");
  });

  it("main 注册给 CoreText 的打包字体不含 HarmonyOS", () => {
    expect(ASSET_PATHS).not.toContain("HarmonyOS");
    expect(ASSET_PATHS).toContain("JetBrainsMonoNerdFontMono-Regular.ttf");
  });

  it("font.store UI 链系统字体优先，CJK 段走 var 引用", () => {
    expect(FONT_STORE).not.toContain("HarmonyOS");
    expect(FONT_STORE).toContain(
      'CJK_STACK_REF = "var(--pier-cjk-font-family)"'
    );
    const uiBlock = FONT_STORE.match(/const UI_FALLBACK = \[([\s\S]*?)\];/);
    expect(uiBlock).not.toBeNull();
    expect(uiBlock?.[1]).toContain('"system-ui"');
    // 系统字体必须排在链首段（emoji / CJK 之前）
    expect(uiBlock?.[1].indexOf('"system-ui"')).toBeLessThan(
      uiBlock?.[1].indexOf("CJK_STACK_REF") ?? -1
    );
  });

  it("font.store 终端链只用真实字体名 (无 generic / var)，CJK = PingFang SC", () => {
    const termBlock = FONT_STORE.match(
      /const MONO_TERMINAL_FALLBACK = \[([\s\S]*?)\];/
    );
    expect(termBlock).not.toBeNull();
    expect(termBlock?.[1]).toContain('"PingFang SC"');
    expect(termBlock?.[1]).not.toContain("CJK_STACK_REF");
    expect(termBlock?.[1]).not.toContain("monospace");
    expect(termBlock?.[1]).not.toContain("ui-monospace");
  });

  it("globals.css 定义 --pier-cjk-font-family 并按界面语言切换", () => {
    expect(GLOBALS_CSS).not.toContain("HarmonyOS");
    expect(GLOBALS_CSS).toContain(
      '--pier-cjk-font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC";'
    );
    // ja/ko 覆盖必须比 :root 默认更具体（:root:lang() 双选择器）
    const ja = GLOBALS_CSS.match(/:root:lang\(ja\)\s*\{([\s\S]*?)\}/);
    const ko = GLOBALS_CSS.match(/:root:lang\(ko\)\s*\{([\s\S]*?)\}/);
    expect(ja?.[1]).toContain("--pier-cjk-font-family");
    expect(ja?.[1]).toContain("Hiragino Sans");
    expect(ko?.[1]).toContain("--pier-cjk-font-family");
    expect(ko?.[1]).toContain("Apple SD Gothic Neo");
    // UI/Mono 链消费同一个 CJK 变量，不允许再写死 CJK 字体名
    expect(GLOBALS_CSS).toContain(
      "var(--pier-cjk-font-family), Menlo, monospace"
    );
  });
});
