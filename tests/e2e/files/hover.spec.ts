import { expect, type Page, test } from "@playwright/test";
import {
  createLspE2eFixture,
  MOD_I,
  waitForEditorLspReady,
} from "../lsp/e2e-harness.ts";

const SYMBOL = "greet";
const DOCUMENTATION = "Returns a friendly greeting.";

async function clickInsideSymbol(page: Page, symbol: string): Promise<void> {
  const editor = page
    .locator('[data-testid="files-code-mirror-editor"] .cm-content')
    .first();
  await expect(editor).toBeVisible({ timeout: 30_000 });

  const point = await editor.evaluate((content, target) => {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue ?? "";
      let start = value.indexOf(target);
      while (start !== -1) {
        const before = value[start - 1] ?? "";
        const after = value[start + target.length] ?? "";
        if (!(/[A-Za-z0-9_$]/u.test(before) || /[A-Za-z0-9_$]/u.test(after))) {
          const offset = start + Math.floor(target.length / 2);
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, Math.min(offset + 1, value.length));
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
          }
        }
        start = value.indexOf(target, start + target.length);
      }
    }
    throw new Error(`Visible symbol not found in CodeMirror: ${target}`);
  }, symbol);

  await page.mouse.click(point.x, point.y);
  await expect(editor).toBeFocused();
}

test("shows real TypeScript symbol information from the keyboard and restores editor focus", async () => {
  test.setTimeout(120_000);
  const fixture = await createLspE2eFixture();

  try {
    await fixture.openFile("first.ts");
    await waitForEditorLspReady(fixture);
    await clickInsideSymbol(fixture.page, SYMBOL);

    await fixture.page.keyboard.press(MOD_I);

    const card = fixture.page.locator(
      '[role="dialog"][data-slot="files-lsp-hover-card"]'
    );
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("aria-modal", "false");
    await expect
      .poll(
        async () =>
          await card.evaluate((element) =>
            element.contains(element.ownerDocument.activeElement)
          )
      )
      .toBe(true);

    const titleId = await card.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    if (!titleId) {
      throw new Error("Symbol information dialog has no accessible title");
    }
    const title = card.locator(`[id=${JSON.stringify(titleId)}]`);
    await expect(title).toBeVisible();
    await expect(title).toHaveText(/Symbol information|符号信息/u);

    const signature = card.locator("pre code").first();
    await expect(signature).toBeVisible();
    await expect(signature).toContainText(SYMBOL);
    await expect(
      card.getByText(DOCUMENTATION, { exact: true }).first()
    ).toBeVisible();

    await fixture.page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(
      fixture.page
        .locator('[data-testid="files-code-mirror-editor"] .cm-content')
        .first()
    ).toBeFocused();
  } finally {
    await fixture.cleanup();
  }
});
