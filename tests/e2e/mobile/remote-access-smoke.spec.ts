import { expect, test } from "@playwright/test";
import { closeApp, launchApp, setWindowSize } from "../support/app-harness.ts";

const SETTINGS_ACCELERATOR =
  process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";

test.describe("Remote access GUI smoke", () => {
  test("开启 LAN 监听、配对、SPA 可达、吊销", async () => {
    test.setTimeout(120_000);
    const context = await launchApp();
    try {
      await setWindowSize(context.app, context.win, 1280, 800);
      const win = context.win;

      await win.keyboard.press(SETTINGS_ACCELERATOR);
      const dialog = win.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 8000 });

      await win.getByTestId("settings-nav-remoteAccess").click();
      await expect(win.locator("#remoteAccess")).toBeVisible({ timeout: 8000 });

      await win.locator("#settings-remote-access-enabled").click();
      const addressEl = win.getByTestId("remote-access-address");
      await expect(addressEl).toBeVisible({ timeout: 15_000 });
      const addressText = (await addressEl.innerText()).trim();
      const portMatch = /:(\d+)$/.exec(addressText);
      expect(portMatch).not.toBeNull();
      const port = Number(portMatch?.[1]);
      expect(port).toBeGreaterThan(0);

      await win.getByTestId("remote-access-generate").click();
      const codeEl = win.getByTestId("remote-access-code");
      await expect(codeEl).toBeVisible({ timeout: 8000 });
      const code = (await codeEl.innerText()).trim();
      expect(code).toMatch(/^\d{6}$/);
      await expect(win.getByTestId("remote-access-qr")).toBeVisible();

      const spaRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(spaRes.status, await spaRes.clone().text()).toBe(200);
      const spaHtml = await spaRes.text();
      expect(spaHtml.toLowerCase()).toContain("<!doctype html");

      const pairRes = await fetch(`http://127.0.0.1:${port}/pair`, {
        body: JSON.stringify({
          code,
          name: "e2e-smoke",
          requestedCapabilities: [
            "app:read",
            "file:read",
            "git:read",
            "notification:read",
            "notification:write",
            "terminal:read",
          ],
          shell: "web",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(pairRes.status).toBe(200);
      const pairBody = (await pairRes.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      expect(pairBody.deviceId.length).toBeGreaterThan(0);
      expect(pairBody.deviceToken.length).toBeGreaterThan(0);

      await expect(win.getByTestId("remote-access-device")).toBeVisible({
        timeout: 8000,
      });

      await win.getByTestId("remote-access-revoke").click();
      await win
        .getByRole("alertdialog")
        .getByRole("button", { name: /吊销|Revoke/ })
        .click();
      await expect(win.getByTestId("remote-access-devices-empty")).toBeVisible({
        timeout: 8000,
      });

      const replay = await fetch(`http://127.0.0.1:${port}/pair`, {
        body: JSON.stringify({
          code,
          requestedCapabilities: ["app:read"],
          shell: "web",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(replay.status).toBe(403);
    } finally {
      await closeApp(context);
    }
  });
});
