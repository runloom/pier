import { expect, type Page, test } from "@playwright/test";
import {
  createLspE2eFixture,
  languageBadge,
  languageStatus,
  saveStatus,
  waitForEditorLspReady,
} from "./lsp-e2e-harness.ts";

async function setLspEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(async (nextEnabled) => {
    await window.pier.pluginSettings.set(
      "pier.files.editor.lspEnabled",
      nextEnabled
    );
  }, enabled);
}

test("keeps real language-service, language, and save statuses independent", async () => {
  test.setTimeout(120_000);
  const fixture = await createLspE2eFixture();

  try {
    const firstView = await fixture.openFile("first.ts", { pin: true });
    const saved = saveStatus(firstView);
    const typescript = languageBadge(firstView, "typescript");

    // Ready is silent in the chrome: only the save status dot + language badge.
    await waitForEditorLspReady(fixture, { serverId: "typescript" });
    await expect(languageStatus(firstView, "ready")).toHaveCount(0);
    await expect(languageStatus(firstView)).toHaveCount(0);
    await expect(saved).toBeVisible();
    await expect(saved).toHaveAccessibleName(/^(?:Saved|已保存)$/u);
    await expect(typescript).toHaveText("TypeScript");
    await expect(typescript).not.toContainText(/Saved|已保存|Ready|已就绪/u);

    await setLspEnabled(fixture.page, false);
    const disabled = languageStatus(firstView, "disabled");
    await expect(disabled).toBeVisible({ timeout: 30_000 });
    await expect(disabled).toHaveAttribute("role", "status");
    await expect(disabled).toHaveText(/^(?:Disabled|已禁用)$/u);
    await expect(saved).toBeVisible();
    await expect(saved).toHaveAccessibleName(/^(?:Saved|已保存)$/u);
    await expect(typescript).toHaveText("TypeScript");

    await setLspEnabled(fixture.page, true);
    await waitForEditorLspReady(fixture, { serverId: "typescript" });
    await expect(languageStatus(firstView, "ready")).toHaveCount(0);
    await expect(languageStatus(firstView, "disabled")).toHaveCount(0);
    await expect(saved).toBeVisible();
    await expect(typescript).toHaveText("TypeScript");

    const unsupportedView = await fixture.openFile("unsupported.txt");
    const unsupported = languageStatus(unsupportedView, "unsupported");
    const unsupportedSaved = saveStatus(unsupportedView);
    const plainText = languageBadge(unsupportedView, "text");
    await expect(unsupported).toBeVisible({ timeout: 30_000 });
    await expect(unsupported).toHaveAttribute("role", "status");
    await expect(unsupported).toHaveAttribute("aria-live", "polite");
    await expect(unsupported).toHaveText(/^(?:Unsupported|不支持)$/u);
    await expect(unsupportedSaved).toBeVisible();
    await expect(unsupportedSaved).toHaveAccessibleName(/^(?:Saved|已保存)$/u);
    await expect(plainText).toHaveText("Plain Text");
    await expect(plainText).not.toContainText(/Saved|已保存/u);
    await expect(unsupported).not.toContainText(/Saved|已保存/u);
  } finally {
    await fixture.cleanup();
  }
});
