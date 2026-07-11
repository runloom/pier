import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  addWidget,
  canvasViewport,
  closeApp,
  type GridSize,
  installCodexPlugin,
  launchApp,
  openMissionControl,
  resizeToBoundary,
  selectTheme,
  setWindowSize,
  viewportMetrics,
} from "./mission-control-e2e-harness.ts";

interface MaterialCase {
  id: string;
  max: GridSize;
  min: GridSize;
  name: string;
}

const MATERIALS: readonly MaterialCase[] = [
  {
    id: "core.activity-overview",
    max: { h: 12, w: 12 },
    min: { h: 2, w: 3 },
    name: "activity overview",
  },
  {
    id: "core.system-resources",
    max: { h: 12, w: 12 },
    min: { h: 2, w: 3 },
    name: "system resources",
  },
  {
    id: "core.custom-card",
    max: { h: 12, w: 6 },
    min: { h: 2, w: 2 },
    name: "custom card",
  },
  {
    id: "pier.codex.accounts",
    max: { h: 10, w: 8 },
    min: { h: 3, w: 2 },
    name: "Codex accounts",
  },
] as const;

const THEMES = [
  { id: "light", label: /浅色|Light/ },
  { id: "dark", label: /深色|Dark/ },
] as const;

async function assertNoHorizontalContentOverflow(card: Locator): Promise<void> {
  const content = card.locator('[data-slot="card-content"]');
  await expect(content).toBeVisible();
  expect(
    await content.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
}

async function assertPrimaryContentUsable(
  win: Page,
  material: MaterialCase,
  card: Locator
): Promise<void> {
  const content = card.locator('[data-slot="card-content"]');
  await assertNoHorizontalContentOverflow(card);
  if (material.id === "core.activity-overview") {
    await expect(
      card.locator('[data-testid="activity-stat-grid"]')
    ).toBeVisible();
    await content.hover();
    await win.mouse.wheel(0, 1200);
    await expect(card.locator('[data-slot="widget-empty"]')).toBeVisible();
    return;
  }
  if (material.id === "core.system-resources") {
    const grid = card.locator('[data-testid="system-resources-grid"]');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await content.hover();
    await win.mouse.wheel(0, 1200);
    await expect(grid.locator(":scope > div").last()).toBeVisible();
    return;
  }
  if (material.id === "core.custom-card") {
    await expect(card.locator('[data-slot="widget-empty"]')).toBeVisible();
    const menu = card.locator(
      '[data-testid="mission-control-widget-menu-trigger"]'
    );
    await menu.scrollIntoViewIfNeeded();
    await menu.click();
    await win
      .locator('[data-testid="mission-control-widget-menu-settings"]')
      .click();
    const dialog = win.locator(
      '[data-testid="mission-control-widget-settings-dialog"]'
    );
    await expect(dialog).toBeVisible();
    await win.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    return;
  }
  const picker = content.getByRole("button").first();
  await picker.scrollIntoViewIfNeeded();
  await picker.click();
  const manage = win.getByRole("menuitem", {
    name: /管理账号|Manage accounts/,
  });
  await expect(manage).toBeVisible();
  await win.keyboard.press("Escape");
  await expect(manage).toHaveCount(0);
}

test.describe("Mission Control responsive ordered grid e2e", () => {
  test("连续跨槽拖拽只按有序槽位推位，不残留 RGL 碰撞空洞", async () => {
    test.setTimeout(120_000);
    const context = await launchApp();
    try {
      await setWindowSize(context.app, context.win, 1600, 1000);
      await openMissionControl(context.win);
      const activity = await addWidget(context.win, "core.activity-overview");
      const system = await addWidget(context.win, "core.system-resources");
      const custom = await addWidget(context.win, "core.custom-card");
      const grid = context.win.locator(
        '[data-testid="mission-control-grid-wrapper"]'
      );
      const activityItem = grid.locator(".react-grid-item").filter({
        has: activity,
      });
      const systemItem = grid.locator(".react-grid-item").filter({
        has: system,
      });
      const customItem = grid.locator(".react-grid-item").filter({
        has: custom,
      });
      const customHandle = custom.locator(
        ".mission-control-widget-drag-handle"
      );
      const activityHandle = activity.locator(
        ".mission-control-widget-drag-handle"
      );
      const systemHandle = system.locator(
        ".mission-control-widget-drag-handle"
      );
      const [customHandleBox, activityHandleBox, systemHandleBox] =
        await Promise.all([
          customHandle.boundingBox(),
          activityHandle.boundingBox(),
          systemHandle.boundingBox(),
        ]);
      if (!(customHandleBox && activityHandleBox && systemHandleBox)) {
        throw new Error("Mission Control drag handles have no bounding box");
      }
      const [activityBefore, systemBefore] = await Promise.all([
        activityItem.boundingBox(),
        systemItem.boundingBox(),
      ]);
      if (!(activityBefore && systemBefore)) {
        throw new Error("Mission Control grid items have no bounding box");
      }

      await customHandle.hover();
      await context.win.mouse.down();
      await context.win.mouse.move(
        customHandleBox.x + customHandleBox.width / 2 + 16,
        customHandleBox.y + customHandleBox.height / 2,
        { steps: 4 }
      );
      await expect(customItem).toHaveClass(/react-draggable-dragging/);
      await context.win.mouse.move(
        activityHandleBox.x + activityHandleBox.width / 2,
        activityHandleBox.y + activityHandleBox.height / 2,
        { steps: 16 }
      );
      await context.win.mouse.move(
        systemHandleBox.x + systemHandleBox.width / 2,
        systemHandleBox.y + systemHandleBox.height / 2,
        { steps: 16 }
      );

      await expect(system.locator("..")).toHaveAttribute(
        "style",
        /translate3d/
      );
      const [activityDuring, systemDuring] = await Promise.all([
        activityItem.boundingBox(),
        systemItem.boundingBox(),
      ]);
      expect(Math.round(activityDuring?.y ?? -1)).toBe(
        Math.round(activityBefore.y)
      );
      expect(Math.round(systemDuring?.y ?? -1)).toBe(
        Math.round(systemBefore.y)
      );

      await context.win.mouse.up();
      await expect(customItem).not.toHaveClass(/react-draggable-dragging/);
      await expect
        .poll(async () => {
          const boxes = await Promise.all([
            activityItem.boundingBox(),
            customItem.boundingBox(),
            systemItem.boundingBox(),
          ]);
          const tops = boxes.map((box) => Math.round(box?.y ?? -10_000));
          return Math.max(...tops) - Math.min(...tops);
        })
        .toBeLessThanOrEqual(2);
      await expect
        .poll(() =>
          grid.evaluate((element) =>
            [
              ...element.querySelectorAll("[data-mission-control-instance-id]"),
            ].map((item) =>
              item
                .querySelector("[data-widget-id]")
                ?.getAttribute("data-widget-id")
            )
          )
        )
        .toEqual([
          "core.activity-overview",
          "core.custom-card",
          "core.system-resources",
        ]);
    } finally {
      await closeApp(context);
    }
  });

  test("窗口变化时自动重算且不产生横向溢出，恢复后保留尺寸偏好", async () => {
    test.setTimeout(120_000);
    const context = await launchApp();
    try {
      await setWindowSize(context.app, context.win, 1700, 1000);
      await openMissionControl(context.win);
      const card = await addWidget(context.win, "core.activity-overview");
      const initialSize = await card.boundingBox();
      const handle = card.locator(".mission-control-widget-drag-handle");
      for (let index = 0; index < 4; index += 1) {
        await handle.press("Shift+ArrowRight");
      }
      await expect
        .poll(async () => Math.round((await card.boundingBox())?.width ?? 0))
        .toBeGreaterThan(Math.round((initialSize?.width ?? 0) + 100));
      const wideSize = await card.boundingBox();
      expect(wideSize).not.toBeNull();

      await setWindowSize(context.app, context.win, 620, 1000);
      const viewport = canvasViewport(context.win);
      await expect
        .poll(async () => (await viewportMetrics(viewport)).scrollWidth)
        .toBeLessThanOrEqual((await viewportMetrics(viewport)).clientWidth);
      const changedSize = await card.boundingBox();
      expect(Math.round(changedSize?.width ?? 0)).not.toBe(
        Math.round(wideSize?.width ?? 0)
      );

      await setWindowSize(context.app, context.win, 1700, 1000);
      await expect
        .poll(async () => Math.round((await card.boundingBox())?.width ?? 0))
        .toBeGreaterThan(Math.round((initialSize?.width ?? 0) + 100));
    } finally {
      await closeApp(context);
    }
  });

  test("Dockview sash 改变 panel 宽度时自动重排且无横向滚动", async () => {
    test.setTimeout(120_000);
    const context = await launchApp();
    try {
      await setWindowSize(context.app, context.win, 1600, 900);
      await openMissionControl(context.win);
      const card = await addWidget(context.win, "core.activity-overview");
      await addWidget(context.win, "core.system-resources");
      await addWidget(context.win, "core.custom-card");
      const viewport = context.win
        .locator('[data-testid="mission-control-grid-wrapper"]')
        .filter({ has: card })
        .locator("..");
      const beforeViewport = await viewport.boundingBox();

      await context.win.keyboard.press("Meta+KeyD");
      const sash = context.win
        .locator(
          ".dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash"
        )
        .first();
      await expect(sash).toBeVisible();
      const sashBox = await sash.boundingBox();
      if (!sashBox) {
        throw new Error("Dockview horizontal sash has no bounding box");
      }
      await context.win.mouse.move(
        sashBox.x + sashBox.width / 2,
        sashBox.y + sashBox.height / 2
      );
      await context.win.mouse.down();
      await context.win.mouse.move(
        sashBox.x + sashBox.width / 2 + 240,
        sashBox.y + sashBox.height / 2,
        { steps: 20 }
      );
      await context.win.mouse.up();

      const afterViewport = await viewport.boundingBox();
      expect(beforeViewport).not.toBeNull();
      expect(afterViewport).not.toBeNull();
      expect(
        Math.abs((afterViewport?.width ?? 0) - (beforeViewport?.width ?? 0))
      ).toBeGreaterThan(100);
      const metrics = await viewportMetrics(viewport);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      await expect(card).toBeVisible();
    } finally {
      await closeApp(context);
    }
  });

  for (const material of MATERIALS) {
    for (const theme of THEMES) {
      test(`${material.name} 在 ${theme.id} 主题的初始、min、max 尺寸保持内容可达且无横向卡内溢出`, async () => {
        test.setTimeout(180_000);
        const context = await launchApp();
        try {
          await setWindowSize(context.app, context.win, 1600, 1000);
          await selectTheme(context.win, theme);
          if (material.id === "pier.codex.accounts") {
            await installCodexPlugin(context);
          }
          await openMissionControl(context.win);
          const card = await addWidget(context.win, material.id);
          await assertPrimaryContentUsable(context.win, material, card);
          await resizeToBoundary(context.win, card, material.min);
          await assertPrimaryContentUsable(context.win, material, card);
          await resizeToBoundary(context.win, card, material.max);
          await assertPrimaryContentUsable(context.win, material, card);
        } finally {
          await closeApp(context);
        }
      });
    }
  }
});
