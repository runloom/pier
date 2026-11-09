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
      /TerminalHoleMask\.apply\(\s*contentView: contentView,\s*terminals: holeViewports,\s*overlays: state\.webOverlayRects\s*\.filter \{ \$0\.paints != false \}\s*\.map \{ \$0\.frame\.nsRect \}\s*\)/u
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
    expect(source).toContain("guard !holes.isEmpty else {");
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
    expect(slice).toContain(
      "setWebOverlayRect(id, readTerminalViewportFrame(), false)"
    );
    expect(slice).toContain("paints: entry.paints");

    const contract = read("src/shared/contracts/terminal.ts");
    expect(contract).toContain("paints?: boolean");

    const validation = read(
      "src/main/ipc/terminal/host-snapshot-validation.ts"
    );
    expect(validation).toContain("rect.paints === undefined");

    const bridge = read(BRIDGE);
    expect(bridge).toContain("let paints: Bool?");
    expect(bridge).toContain("$0.paints != false");

    expect(read("AGENTS.md")).toContain("paints: false");
    expect(read(SPEC)).toContain("paints: false");
  });

  it("keeps modal scrims as input capture while registering dialog cards", () => {
    // 设置 / 确认弹窗的整窗 scrim 是输入捕获层：paints:false 只进事件路由，
    // 否则整窗回填会把所有终端洞抹空，不透明 backing 下设置打开时终端整块
    // 消失。卡片本身是不透明 web 面，必须单独登记回填，native 终端才不会
    // 盖住 Dialog 内容。
    const dialog = read(DIALOG);
    expect(dialog).toContain("useTerminalOverlay({ paints: false })");
    expect(dialog).toContain(
      "const contentOverlay = useTerminalOverlayRegistration()"
    );
    expect(dialog).toContain("ref={contentRef}");

    const alertDialog = read(ALERT_DIALOG);
    expect(alertDialog).toContain("paints: false");
    expect(alertDialog).toContain(":content");
    expect(alertDialog).toContain("ref={contentRef}");
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
