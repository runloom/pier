import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CALLBACKS_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Controller/TerminalController+Callbacks.swift"
);
const ROUTING_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Host/ClipboardRouting.swift"
);
const CONFIG_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Controller/TerminalController+Config.swift"
);
const APP_TERMINAL_INPUT_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+Input.swift"
);
const GHOSTTY_BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const braceStart = source.indexOf("{", start);
  expect(braceStart).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  throw new Error(`unclosed ${signature} body`);
}

/**
 * 剪贴板种类路由治理（对齐 Ghostty.app）：
 * - selection 剪贴板（copy-on-select / 中键粘贴 / OSC 52 "s"）必须落在私有
 *   pasteboard，绝不触碰系统剪贴板 —— 否则任何终端里的意外拖选都会覆盖
 *   用户刚复制的内容，空白选区（trim 后为空串）会直接清空系统剪贴板，
 *   表现为「跨窗口粘贴没有内容」。
 * - 空串写入必须被拒绝：空 string flavor 在读侧等价于「无内容」。
 */
describe("native terminal clipboard routing", () => {
  it("declares selection clipboard support so copy-on-select does not fall back to the system clipboard", () => {
    const config = readSource(CONFIG_PATH);
    // ghostty 的 copy-on-select=true 在 supportsClipboard(.selection)=false
    // 时会 fallback 写 .standard（直接写系统剪贴板，比现状更糟）。
    expect(config).toContain(
      "runtimeConfig.supports_selection_clipboard = true"
    );
  });

  it("routes write by clipboard kind instead of hardcoding the system pasteboard", () => {
    const body = extractFunctionBody(
      readSource(CALLBACKS_PATH),
      "static func writeClipboard("
    );

    // 未知种类（zig primary=2 / OSC 52 "p"）必须 fail-closed，不得回退
    // 到 standard/general。
    expect(body).toContain(
      "guard let kind = TerminalClipboardKind(clipboard) else"
    );
    expect(body).toContain("NSPasteboard.pierTerminal(for: kind)");
    expect(body).not.toContain("NSPasteboard.general");
  });

  it("rejects empty standard writes before touching any pasteboard", () => {
    const body = extractFunctionBody(
      readSource(CALLBACKS_PATH),
      "static func writeClipboard("
    );

    const guardAt = body.indexOf(
      "TerminalClipboardWritePolicy.shouldWrite(string, to: kind)"
    );
    const writeAt = body.indexOf("NSPasteboard.pierTerminal(for: kind)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(guardAt);
  });

  it("reads selection paste from the private pasteboard and keeps image fallback standard-only", () => {
    const body = extractFunctionBody(
      readSource(CALLBACKS_PATH),
      "static func readClipboard("
    );

    expect(body).toContain(
      "guard let kind = TerminalClipboardKind(clipboard) else"
    );
    expect(body).toContain("NSPasteboard.pierTerminalSelection");

    // UIKit 分支在前也有 case 标签，锚定到 AppKit 段再断言顺序。
    const appKitAt = body.indexOf("#elseif canImport(AppKit)");
    expect(appKitAt).toBeGreaterThan(-1);
    const appKit = body.slice(appKitAt);

    const standardCaseAt = appKit.indexOf("case .standard:");
    const selectionCaseAt = appKit.indexOf("case .selection:");
    const imageFallbackAt = appKit.indexOf(
      "terminalPasteImagePathFromPasteboard(pasteboard)"
    );
    expect(standardCaseAt).toBeGreaterThan(-1);
    expect(selectionCaseAt).toBeGreaterThan(standardCaseAt);
    // 图片兜底只属于 standard 分支（截图只会在系统剪贴板上）。
    expect(imageFallbackAt).toBeGreaterThan(standardCaseAt);
    expect(imageFallbackAt).toBeLessThan(selectionCaseAt);
  });

  it("keeps the private selection pasteboard off the system pasteboard namespace", () => {
    const routing = readSource(ROUTING_PATH);

    expect(routing).toContain('"io.pier.app.terminal.selection"');
    expect(routing).toContain("case .standard:");
    expect(routing).toContain("return .general");
    expect(routing).toContain("return .pierTerminalSelection");
  });

  it("fails closed for clipboard kinds Pier cannot route", () => {
    const routing = readSource(ROUTING_PATH);

    // failable init：未知枚举（含 zig primary=2）返回 nil，禁止「非
    // selection 即 standard」的 fail-open 映射。
    expect(routing).toContain("init?(_ raw: ghostty_clipboard_e)");
    expect(routing).toMatch(/default:\s*return nil/);
    expect(routing).not.toMatch(
      /raw == GHOSTTY_CLIPBOARD_SELECTION \? \.selection : \.standard/
    );
  });

  it("scopes the empty-write rejection to the standard pasteboard", () => {
    const routing = readSource(ROUTING_PATH);

    // 私有 selection 板必须接受空写：空白选区要清掉陈旧中键内容
    //（对齐 Ghostty.app）；只有系统剪贴板拒绝空串。
    expect(routing).toContain(
      "static func shouldWrite(_ string: String, to kind: TerminalClipboardKind) -> Bool"
    );
    expect(routing).toContain("kind == .selection || !string.isEmpty");
  });

  it("fails closed when ghostty requires a write confirm Pier cannot render", () => {
    const body = extractFunctionBody(
      readSource(CALLBACKS_PATH),
      "static func writeClipboard("
    );

    const confirmGuardAt = body.indexOf("guard !confirm else");
    const writeAt = body.indexOf("NSPasteboard.pierTerminal(for: kind)");
    expect(confirmGuardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(confirmGuardAt);
  });
});

/**
 * 菜单/右键 responder 动作（copy:/paste:/selectAll:）是单派发显式命令，只会
 * 到达 key window 响应链上的视图，web 侧不可能重复处理；焦点路由转场帧里
 * coordinator 的 hostKeyboardActive 落后于 first responder，用它做门禁会把
 * 用户的复制/粘贴静默吞掉（表现为「跨窗口粘贴没有内容」）。环境键事件
 * （keyDown / performKeyEquivalent）与 web 浮层键盘归属存在真实竞态，门禁
 * 必须保留。
 */
describe("native terminal responder action gating", () => {
  it("does not gate copy/paste/selectAll responder actions on hostKeyboardActive", () => {
    const source = readSource(APP_TERMINAL_INPUT_PATH);

    for (const signature of [
      "@IBAction open func copy(",
      "@IBAction func paste(",
      "@IBAction override open func selectAll(",
    ]) {
      const body = extractFunctionBody(source, signature);
      expect(body).not.toContain("hostKeyboardActive");
    }
  });

  it("keeps the hostKeyboardActive gate on ambient key events", () => {
    const source = readSource(APP_TERMINAL_INPUT_PATH);

    for (const signature of [
      "override open func keyDown(",
      "override open func performKeyEquivalent(",
      "override open func keyUp(",
      "override open func flagsChanged(",
      "override open func doCommand(",
    ]) {
      const body = extractFunctionBody(source, signature);
      expect(body).toContain("hostKeyboardActive");
    }
  });
});

/**
 * Cmd+C/V/A 与 App menu 的 role 双占：menu role 走 `window.firstResponder`，
 * 原生终端 FR 是异步移交的（且 focusesOnMouseDown=false）。FR 还停在 web 时，
 * menu 先消费 Cmd+C 并复制空的 web 选区，Ghostty 永远收不到复制动作。
 * 键盘归属已在终端时必须由事件路由先处理三连键，再让 menu 处理其它 Cmd 组合。
 */
describe("terminal keyboard clipboard chords", () => {
  function routeKeyDownBody(): string {
    return extractFunctionBody(
      readSource(GHOSTTY_BRIDGE_PATH),
      "private func routeKeyDown("
    );
  }

  it("handles clipboard chords before the app menu claims the key equivalent", () => {
    const body = routeKeyDownBody();
    const clipboardAt = body.indexOf("terminalClipboardAction");
    const performAt = body.indexOf("performClipboardAction");
    const menuAt = body.indexOf("NSApp.mainMenu?.performKeyEquivalent");

    expect(clipboardAt).toBeGreaterThan(-1);
    expect(performAt).toBeGreaterThan(clipboardAt);
    expect(menuAt).toBeGreaterThan(performAt);
  });

  it("routes clipboard chords by terminal keyboard ownership, not first responder", () => {
    const source = readSource(GHOSTTY_BRIDGE_PATH);
    const body = extractFunctionBody(source, "func performClipboardAction(");

    expect(body).toContain("activeTerminalPanelId(for: window)");
    expect(body).not.toContain("firstResponder");
    expect(body).not.toContain("hostKeyboardActive");
  });

  it("keeps web-owned keyboards and undelivered chords on the original path", () => {
    const body = routeKeyDownBody();
    const webGuardAt = body.indexOf("guard activeTerminalPanelId != nil else");
    const clipboardAt = body.indexOf("terminalClipboardAction");

    // 浮层/设置等 web 焦点把键盘归属拉走后，⌘C 必须仍归 web。
    expect(webGuardAt).toBeGreaterThan(-1);
    expect(clipboardAt).toBeGreaterThan(webGuardAt);

    // 只有终端真正派发了 binding action 才消费事件；失败要能回落。
    expect(body).not.toContain(
      "_ = GhosttyBridgeImpl.shared.performClipboardAction"
    );
    expect(body).toContain(
      "GhosttyBridgeImpl.shared.performClipboardAction(action, for: window) {"
    );
  });

  it("maps only bare Cmd+C/V/A onto terminal clipboard actions", () => {
    const source = readSource(GHOSTTY_BRIDGE_PATH);
    const body = extractFunctionBody(
      source,
      "static func terminalClipboardAction("
    );

    expect(body).toContain("relevant == .command");
    expect(body).toContain('case "c":');
    expect(body).toContain('case "v":');
    expect(body).toContain('case "a":');
  });

  it("uses Ghostty clipboard binding names", () => {
    const body = extractFunctionBody(
      readSource(GHOSTTY_BRIDGE_PATH),
      "var bindingAction: String"
    );

    expect(body).toContain('"copy_to_clipboard"');
    expect(body).toContain('"paste_from_clipboard"');
    expect(body).toContain('"select_all"');
  });
});
