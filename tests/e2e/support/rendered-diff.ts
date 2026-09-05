import { expect, type Locator } from "@playwright/test";

export async function expectRenderedLocalDiff(peek: Locator) {
  const preview = peek.locator('[data-slot="markdown-change-preview"]');
  await expect(preview.locator("p del")).toHaveText("Before");
  await expect(preview.locator("p ins")).toHaveText("Current");
  await expect(preview.locator("p")).toContainText("text");
  await expect(preview.locator("pre")).toHaveCount(0);
  expect(
    await preview.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
  await peek.getByRole("tab", { name: /Source|源码/u }).click();
  await expect(
    peek.locator("[data-line]").filter({ hasText: "Before text" }).first()
  ).toBeVisible();
  await peek.getByRole("tab", { name: /Preview|预览/u }).click();
  await expect(preview.locator("p del")).toBeVisible();
}
