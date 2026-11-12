import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const THIS_TEST = "tests/unit/native/terminal-hole-mask-governance.test.ts";
const SPEC =
  "docs/superpowers/specs/2026-09-04-transparent-web-over-ghostty-compositing-gold-standard.md";
const MASK = "native/Sources/GhosttyBridge/TerminalHoleMask.swift";
const BRIDGE = "native/Sources/GhosttyBridge/GhosttyBridge.swift";
const NATIVE_TESTS =
  "native/Tests/GhosttyBridgeTests/TerminalHoleMaskTests.swift";
const SASH_OVERLAYS = "src/renderer/lib/workspace/sash-web-overlays.ts";
const WORKSPACE_HOST = "src/renderer/components/workspace/host.tsx";
const SASH_OVERLAY_TESTS =
  "tests/unit/renderer/lib/workspace/sash-web-overlays.test.ts";
const WINDOW_FACTORY = "src/main/windows/factory.ts";
const WINDOW_MANAGER = "src/main/windows/manager.ts";
const NATIVE_CHROME = "src/main/windows/native-chrome.ts";
const THEME_COLORS = "src/shared/theme-colors.ts";
const WINDOW_MANAGER_TEST =
  "tests/unit/main/app-core/window-manager-webcontents-view.test.ts";
const DIALOG = "packages/ui/src/dialog.tsx";
const ALERT_DIALOG = "packages/ui/src/alert-dialog.tsx";
const COMMAND = "packages/ui/src/command.tsx";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("terminal hole mask governance (transparent web over Ghostty)", () => {
  it("documents the native hard guarantee in AGENTS.md and the gold standard", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("### 透明 web 叠 Ghostty 合成");
    expect(agents).toContain("TerminalHoleMask");
    expect(agents).toContain("`webOverlayRects`");
    expect(agents).toContain(THIS_TEST);

    const spec = read(SPEC);
    expect(spec).toContain("## 根因与 hard guarantee（native 洞遮罩）");
    expect(spec).toContain("`ViewsCompositorSuperview.layer`");
    expect(spec).toContain("用户 HTML 不可控");
    expect(spec).toContain("webOverlayRects");
    expect(spec).toContain("`CATransaction.setDisableActions(true)`");
    // 压在终端上的产品 chrome 必须登记，否则被硬裁（分栏线消失）。
    expect(spec).toContain(".dv-sash");
    expect(spec).toContain("sash-web-overlays.ts");
    expect(agents).toContain("分栏 sash");
  });

  it("registers dockview sash and floating groups as workspace web overlays", () => {
    const source = read(SASH_OVERLAYS);
    expect(source).toContain('".dv-sash"');
    expect(source).toContain('".dv-resize-container"');
    expect(source).toContain("registerTerminalElementWebOverlay");
    // sash 位置走 inline style；等分 / 键盘改布局没有 pointerup，必须盯 style。
    expect(source).toContain('attributeFilter: ["style"]');
    expect(source).toContain("onDidLayoutChange");
    // 浮组切 tab 只改可见性：必须跟随 active panel change 重算回填目标。
    expect(source).toContain("onDidActivePanelChange");
    // 浮组内含可见终端时不得整块回填，否则会抹掉终端自己的洞。
    expect(source).toContain("holdsVisibleTerminal");
    expect(source).toContain("dv-floating-titlebar");
    expect(source).toContain("entry.registration.dispose()");

    const host = read(WORKSPACE_HOST);
    expect(host).toContain("attachWorkspaceSashWebOverlays");
    expect(host).toContain("sashWebOverlayDispose()");

    const tests = read(SASH_OVERLAY_TESTS);
    expect(tests).toContain('"dockview-sash:"');
    expect(tests).toContain("refreshes geometry when dockview rewrites");
    expect(tests).toContain("floating group holds a visible terminal");
  });

  it("applies the mask from applyWindowState using visible viewports and overlay rects", () => {
    const bridge = read(BRIDGE);
    // 可见终端收集：只有 entry.visible 的 viewport 才能被挖洞。
    expect(bridge).toContain("var holeViewports: [NSRect] = []");
    expect(bridge).toContain("holeViewports.append(viewport)");
    // 调用点必须同时传终端与浮层，浮层是回填的唯一来源；仅输入捕获
    // （paints=false）的全屏浮层不得参与回填，否则整窗矩形会抹空所有洞。
    expect(bridge).toMatch(
      /TerminalHoleMask\.apply\(\s*contentView: contentView,\s*terminals: holeViewports,\s*overlays: state\.webOverlayRects\s*\.filter \{ \$0\.paints != false \}\s*\.map \{\s*TerminalHoleMask\.Overlay\(\s*radius: CGFloat\(\$0\.radius \?\? 0\),\s*rect: \$0\.frame\.nsRect\s*\)\s*\}\s*\)/u
    );
    // closeAll（renderer reload / window close）必须清 mask，防止无终端时仍挖洞。
    expect(bridge).toContain(
      "TerminalHoleMask.clear(contentView: contentView)"
    );
    // debug snapshot 暴露 mask 状态，供 e2e / 诊断核对洞位。
    expect(bridge).toContain(
      'windowPayload["holeMask"] = TerminalHoleMask.debugPayload'
    );
  });

  it("keeps the mask layer hard-edged, actionless and scoped to the compositor", () => {
    const source = read(MASK);
    expect(source).toContain('name.contains("ViewsCompositorSuperview")');
    expect(source).toContain("mask.fillRule = .evenOdd");
    expect(source).toContain("CATransaction.setDisableActions(true)");
    // 无洞时移除，而不是留一张全透明的消费层。
    expect(source).toContain("guard !holes.isEmpty || !corners.isEmpty else {");
    expect(source).toContain("removeMask(from: compositor)");
    // 浮层回填必须做矩形减法，不是把整块浮层矩形加进路径。
    expect(source).toContain("terminals: [NSRect], overlays: [NSRect]");
    expect(source).toContain("subtract($0, overlay)");
    // 坐标换算：contentView top-left → 合成层 bottom-left。
    expect(source).toContain(
      "contentView.bounds.height - topLeft.minY - topLeft.height"
    );
  });

  it("keeps the web surface opaque and synced with the window chrome color", () => {
    // 透明 WebContentsView backing 会让 Chromium 部分重绘保留旧帧像素：
    // 缩放后终端状态栏残留缩放前文字（2026-11-09）。终端透出由洞遮罩负责，
    // web 表面必须整体不透明。
    const factory = read(WINDOW_FACTORY);
    expect(factory).toContain("appView.setBackgroundColor(");
    expect(factory).toContain("baseOpts.backgroundColor");
    expect(factory).not.toContain("00000000");

    const chrome = read(NATIVE_CHROME);
    expect(chrome).toContain("window.setBackgroundColor(color)");
    expect(chrome).toContain("appView.setBackgroundColor(color)");
    expect(chrome).toContain("appView.webContents.isDestroyed()");

    const manager = read(WINDOW_MANAGER);
    expect(manager).toContain("setNativeWindowChromeColor(window, color)");

    expect(read(THEME_COLORS)).not.toContain("00000000");
    expect(read(WINDOW_MANAGER_TEST)).toContain('"#1e1e1e"');

    expect(read("AGENTS.md")).toContain("web 表面不透明");
    expect(read(SPEC)).toContain("web 表面不透明");
    expect(read(SPEC)).toContain("buffer age");
  });

  it("separates input-capture overlays from paint overlays for the hole mask", () => {
    // 全屏输入捕获层（菜单 / popover 打开、sash 拖拽）本身不画像素：
    // 它必须留在事件路由里，但不得回填进洞，否则整窗矩形会抹空所有洞，
    // 不透明 backing 下终端整块消失（2026-11-09 sash 拖拽复现）。
    const slice = read("src/renderer/stores/terminal-input-routing-slice.ts");
    expect(read("src/renderer/stores/terminal-scrim/fullscreen.ts")).toContain(
      "overlayRect(id, readTerminalViewportFrame(), false)"
    );
    expect(slice).toContain("paints: entry.paints");

    const contract = read("src/shared/contracts/terminal.ts");
    expect(contract).toContain("paints?: boolean");

    const validation = read(
      "src/main/ipc/terminal/host-snapshot-validation.ts"
    );
    expect(validation).toContain("rect.paints === undefined");
    expect(validation).toContain("isScrimColor(rect.scrim)");
    expect(validation).toContain("isCornerRadius(rect.radius)");
    expect(read("src/shared/contracts/terminal.ts")).toContain(
      "radius?: number"
    );
    expect(read(MASK)).toContain("cornerHolePath");
    expect(slice).toContain("readOverlayAppearance");
    expect(read("src/renderer/stores/terminal-scrim/appearance.ts")).toContain(
      "readOverlayShadows"
    );

    const bridge = read(BRIDGE);
    expect(bridge).toContain("let paints: Bool?");
    expect(bridge).toContain("$0.paints != false");
    expect(bridge).toContain("TerminalScrim.apply");
    expect(bridge).toContain("TerminalScrim.clear");
    expect(read("native/Sources/GhosttyBridge/TerminalScrim.swift")).toContain(
      "contentView.addSubview(view, positioned: .below, relativeTo: compositor)"
    );

    expect(read("AGENTS.md")).toContain("paints: false");
    expect(read("AGENTS.md")).toContain("TerminalScrim");
    expect(read(SPEC)).toContain("paints: false");
    expect(read(SPEC)).toContain("TerminalScrim");
    expect(read(SPEC)).toContain("TerminalShadow");
    expect(read("AGENTS.md")).toContain("TerminalShadow");
    expect(read("native/Sources/GhosttyBridge/TerminalShadow.swift")).toContain(
      "layerBlur"
    );
    expect(bridge).toContain("TerminalShadow.apply");
    expect(bridge).toContain("TerminalShadow.clear");
    expect(read("src/shared/contracts/terminal.ts")).toContain(
      "shadows?: TerminalBoxShadow[]"
    );
    expect(validation).toContain("isOverlayShadows(rect.shadows)");

    const css = read("src/renderer/app/globals.css");
    const fadeIn = css.slice(
      css.indexOf("@keyframes pier-overlay-fade-in"),
      css.indexOf("@keyframes pier-overlay-fade-out")
    );
    expect(fadeIn).toContain("opacity");
    expect(fadeIn).not.toContain("transform");
    expect(fadeIn).not.toContain("filter");
  });

  it("keeps modal scrims as input capture while registering dialog cards", () => {
    // 设置 / 确认弹窗的整窗 scrim 不回填洞：paints:false 只进事件路由，
    // 否则整窗回填会把所有终端洞抹空。蒙层色经 scrim 交给 native，在洞里
    // 画同色半透明。卡片本身是不透明 web 面，必须单独登记回填。
    const dialog = read(DIALOG);
    expect(dialog).toContain(
      "useTerminalOverlay({ paints: false, scrim: true })"
    );
    expect(dialog).toContain(
      "const contentOverlay = useTerminalOverlayRegistration()"
    );
    expect(dialog).toContain("ref={contentRef}");

    const alertDialog = read(ALERT_DIALOG);
    expect(alertDialog).toContain("paints: false");
    expect(alertDialog).toContain("scrim: true");
    expect(alertDialog).toContain(":content");
    expect(alertDialog).toContain("ref={contentRef}");
  });

  it("keeps modal shells geometrically still so the hole tracks them", () => {
    // 快照管道有 IPC 往返，追不上逐帧动画。卡片壳若用 transform 入场
    // （zoom-in / slide-in），100ms 内矩形一直在滑，洞冻结在动画起点的
    // 位置 → 洞外的卡片被硬裁、洞里露出终端（设置框左上角穿帮）。
    // 壳的居中也不许靠 transform：enter keyframe 的 from 恒为
    // translate3d(0,0,0)，与 -translate-x/y-1/2 抢同一属性，fade 也会滑
    // 半张卡片。居中走 inset + margin。top 必须是标题栏下沿而不是旧的
    // 垂直中线：去掉 -translate-y-1/2 后若 top 仍是中线，上边缘会落在
    // 中线，弹窗整体下移半高（设置框 h-[90vh] 大半掉出窗口）。
    const dialog = read(DIALOG);
    // tw-animate 的 enter/exit 不只改 opacity：整段过渡 filter 都是
    // blur(0)、transform 都是 translate3d(0,0,0)。filter 正是洞合成禁止的，
    // 底部状态栏在洞外跟着这层走，和洞里的 native 蒙层错拍。淡入淡出只能动 opacity。
    expect(dialog).not.toContain("data-open:fade-in-0");
    expect(dialog).not.toContain("data-open:animate-in");
    expect(dialog).toContain("pier-overlay-fade-in");
    expect(dialog).toContain("pier-overlay-fade-out");
    expect(dialog).not.toContain("data-open:zoom-in-95");
    expect(dialog).not.toContain("-translate-x-1/2");
    expect(dialog).not.toContain("-translate-y-1/2");
    expect(dialog).not.toContain("(100vh-var(--app-titlebar-height))/2");
    expect(dialog).toContain("fixed inset-x-0");
    expect(dialog).toContain("top-[var(--app-titlebar-height)]");
    expect(dialog).toContain("bottom-0");
    expect(dialog).toContain("h-fit");
    expect(dialog).toContain("m-auto");
    expect(dialog).toContain("w-full");
    expect(dialog).not.toContain("w-fit");

    const alertDialog = read(ALERT_DIALOG);
    expect(alertDialog).not.toContain("data-open:fade-in-0");
    expect(alertDialog).not.toContain("data-open:animate-in");
    expect(alertDialog).toContain("pier-overlay-fade-in");
    expect(alertDialog).toContain("pier-overlay-fade-out");
    expect(alertDialog).not.toContain("data-open:zoom-in-95");
    expect(alertDialog).not.toContain("-translate-x-1/2");
    expect(alertDialog).not.toContain("-translate-y-1/2");
    expect(alertDialog).not.toContain("(100vh-var(--app-titlebar-height))/2");
    expect(alertDialog).toContain("fixed inset-x-0");
    expect(alertDialog).toContain("top-[var(--app-titlebar-height)]");
    expect(alertDialog).toContain("bottom-0");
    expect(alertDialog).toContain("h-fit");
    expect(alertDialog).toContain("m-auto");
    expect(alertDialog).toContain("w-full");
    expect(alertDialog).not.toContain("w-fit");

    // 命令面板钉在 1/3。bottom 必须放开，否则 m-auto 会在 top-1/3 和
    // 窗口底之间重新居中，面板比原来更低。不要再用 translate 抵消。
    const command = read(COMMAND);
    expect(command).toContain("top-1/3");
    expect(command).toContain("bottom-auto");
    expect(command).not.toContain("translate-y-0");
  });

  it("registers the composer autocomplete portal as a paint overlay", () => {
    // 补全列表向 composer 上方展开、压在终端 viewport 内；不登记会被硬裁。
    const portal = read(
      "src/renderer/panel-kits/terminal/structured-composer/composer-autocomplete-portal.tsx"
    );
    expect(portal).toContain("useTerminalOverlayRegistration");
    expect(portal).toContain("ref={overlayRef}");
    expect(portal).toContain("flushOverlay()");
  });

  it("carries native tests for holes, overlay re-add, clearing and coordinate flip", () => {
    const tests = read(NATIVE_TESTS);
    for (const name of [
      "testOverlayInsideTerminalSplitsHoleWithoutLosingArea",
      "testOverlayCoveringTerminalRemovesHole",
      "testOverlappingTerminalRectsMergeIntoOneHole",
      "testLayerRectFlipsTopLeftIntoBottomLeft",
      "testApplyWindowStateInstallsMaskAndClearsWhenTerminalHidden",
      "testApplyWindowStateReAddsRegisteredOverlayArea",
      "testCloseAllClearsMask",
    ]) {
      expect(tests).toContain(name);
    }
  });
});
