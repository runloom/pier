import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";
import {
  killAndWait,
  makeTempUserDataDir,
  OUT_MAIN,
  PROJECT_ROOT,
  removeDirectory,
} from "./e2e-harness.ts";

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

const actionLabels: Record<string, string> = {
  en: "Scroll to Bottom",
  ja: "最下部に移動",
  ko: "맨 아래로 이동",
  "zh-CN": "回到底部",
};

/** Real addon access is only for arranging scrollback and reading the viewport.
 * Navigation under test goes through the keypress IPC or renderer UI. */
async function viewport(
  app: ElectronApplication,
  panelId: string,
  setup?: "fill" | "pin"
): Promise<string | null> {
  return await app.evaluate(
    ({ BaseWindow }, args) => {
      const { createRequire } = process.getBuiltinModule("module");
      const { join } = process.getBuiltinModule("path");
      const require = createRequire(join(args.projectRoot, "package.json"));
      const addon = require(
        join(args.projectRoot, "native/build/Release/ghostty_native.node")
      ) as {
        injectDisplayText: (id: string, text: string) => boolean;
        performTerminalBindingAction: (id: string, action: string) => boolean;
        readViewportText: (id: string) => string | null;
      };
      const window = BaseWindow.getAllWindows()[0];
      if (!window) throw new Error("test window missing");
      const nativePanelId = `${window.id}::${args.panelId}`;
      if (args.setup === "fill") {
        const output = Array.from(
          { length: 400 },
          (_, index) => `pier-e2e-scroll-${index}\r\n`
        ).join("");
        if (!addon.injectDisplayText(nativePanelId, output))
          throw new Error("terminal not ready");
      }
      if (
        args.setup === "pin" &&
        !addon.performTerminalBindingAction(nativePanelId, "scroll_to_top")
      ) {
        throw new Error("could not arrange scrollback review");
      }
      return addon.readViewportText(nativePanelId);
    },
    { panelId, projectRoot: PROJECT_ROOT, setup }
  );
}

test("Cmd+Down, palette and context menu return the real terminal viewport to the latest output", async () => {
  test.setTimeout(60_000);
  const userDataDir = makeTempUserDataDir("pier-scroll-e2e-");
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
  try {
    const win = await app.firstWindow();
    console.info("[scroll-e2e] window opened");
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
      timeout: 15_000,
    });
    const language = await win.locator("html").getAttribute("lang");
    const label = actionLabels[language ?? ""];
    if (!label) throw new Error(`unsupported test language: ${language}`);
    const tab = win.locator('[data-panel-tab-id^="terminal-"]').first();
    const panelId = await tab.getAttribute("data-panel-tab-id");
    if (!panelId) throw new Error("terminal panel ID missing");
    await expect
      .poll(() => viewport(app, panelId), { timeout: 15_000 })
      .not.toBeNull();
    console.info("[scroll-e2e] native viewport ready");
    await viewport(app, panelId, "fill");
    await expect
      .poll(() => viewport(app, panelId))
      .toContain("pier-e2e-scroll-399");
    await viewport(app, panelId, "pin");
    await expect
      .poll(() => viewport(app, panelId))
      .not.toContain("pier-e2e-scroll-399");
    console.info("[scroll-e2e] history pinned");

    // Exercise the rebuilt native keybinding with Cmd+Down's physical keycode,
    // independently of the menu's explicit scroll_to_bottom action.
    const keypress = await win.evaluate(
      (id) =>
        window.pier.terminal.sendKeyPress({
          panelId: id,
          keycode: 0x7d,
          mods: 8,
        }),
      panelId
    );
    expect(keypress.ok).toBe(true);
    await expect
      .poll(() => viewport(app, panelId))
      .toContain("pier-e2e-scroll-399");
    console.info("[scroll-e2e] native Cmd+Down returned to live");
    await viewport(app, panelId, "pin");

    await win.keyboard.press("Meta+Shift+KeyP");
    await expect(win.locator("[cmdk-input]")).toBeVisible();
    await win.locator("[cmdk-input]").fill(label);
    const command = win.locator("[cmdk-item]").filter({ hasText: label });
    await expect(command).toHaveCount(1);
    // Keep the assertion independent of any focus/keystroke side effects of
    // opening the palette: only selecting the command may return to live.
    await viewport(app, panelId, "pin");
    await expect
      .poll(() => viewport(app, panelId))
      .not.toContain("pier-e2e-scroll-399");
    await command.click();
    await expect(win.locator("[cmdk-input]")).not.toBeAttached();
    await expect
      .poll(() => viewport(app, panelId))
      .toContain("pier-e2e-scroll-399");
    console.info("[scroll-e2e] palette returned to live");

    await viewport(app, panelId, "pin");
    await expect
      .poll(() => viewport(app, panelId))
      .not.toContain("pier-e2e-scroll-399");
    // Select the real native MenuItem without depending on OS menu tracking in CI.
    // Menu construction, close callback, renderer dispatch and native IPC stay real.
    await app.evaluate(
      ({ Menu, webContents }, target) => {
        const originalPopup = Menu.prototype.popup;
        Menu.prototype.popup = function (options) {
          Menu.prototype.popup = originalPopup;
          const item = this.items.find((entry) => entry.label === target.label);
          if (!item?.enabled)
            throw new Error("scroll to bottom menu entry unavailable");
          Reflect.apply(item.click, item, [item, undefined, {}]);
          options?.callback?.();
        };
        for (const contents of webContents.getAllWebContents()) {
          if (contents.getType() === "window" && !contents.isDestroyed()) {
            contents.send("pier:terminal:request-context-menu", {
              panelId: target.panelId,
              x: 20,
              y: 20,
            });
          }
        }
      },
      { label, panelId }
    );
    await expect
      .poll(() => viewport(app, panelId))
      .toContain("pier-e2e-scroll-399");
    console.info("[scroll-e2e] context menu returned to live");
    await expect(win.locator('[role="alertdialog"]')).not.toBeAttached();
  } finally {
    // This fixture has no state to save. Bound teardown even if Electron stops
    // servicing CDP while a native operation or window close is pending.
    await killAndWait(app.process());
    removeDirectory(userDataDir);
  }
});
