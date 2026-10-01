import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { selectTheme, setWindowSize } from "../support/app-harness.ts";
import {
  type ConflictFixture,
  chooseNativeMenu,
  currentText,
  incomingText,
  MANUAL_RESOLUTION,
  withConflictReview,
} from "./conflict-fixture.ts";

const ACCEPT_INCOMING =
  /Accept Incoming Change|接受传入变更|取り込み側の変更を採用|들어오는 변경 수락/u;
const CONFIRM_DELETE = /^(?:Confirm Delete|确认删除|削除を確定|삭제 확인)$/u;
const TAKE_INCOMING =
  /^(?:Use Incoming Version|采用传入版本|取り込み側の版を使う|들어오는 버전 사용)$/u;
const STAGE_CURRENT =
  /^(?:Stage Current File|暂存当前文件|現在のファイルをステージ|현재 파일 스테이징)$/u;
const COPY_PATH = /^(?:Copy Path|复制路径|パスをコピー|경로 복사)$/u;
const JUMP_SOURCE =
  /^(?:Jump to Source|跳转到源码|ソースへジャンプ|소스로 이동)$/u;
const RESOLVE_FAILED =
  /Could not resolve conflict|无法解决冲突|競合を解決できませんでした|충돌을 해결하지 못했습니다/u;

// These scenarios open a terminal through Pier's real CLI, not a host stub.
test.skip(
  process.platform !== "darwin",
  "Pier's native terminal requires macOS"
);

function reviewRoot(page: Page): Locator {
  return page.locator(
    '[data-git-review-surface][aria-hidden="false"] [data-testid="pierre-diff-root"]'
  );
}

function member(page: Page, path: string): Locator {
  return reviewRoot(page).locator(
    `diffs-container[data-pier-file-path="${path}"]`
  );
}

function markerBody(page: Page, path: string): Locator {
  return reviewRoot(page).locator(`[data-pier-unresolved-path="${path}"]`);
}

async function navigateTo(page: Page, path: string): Promise<void> {
  await expect(
    page.locator(
      '[data-git-review-surface][aria-hidden="false"] [data-git-review-mutation-blocked="true"]'
    )
  ).toHaveCount(0, { timeout: 20_000 });
  const row = page.getByTestId("git-review-tree").getByRole("treeitem", {
    name: new RegExp(path.replaceAll(".", "\\."), "u"),
  });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(
    member(page, path).locator("[data-diffs-header]")
  ).toBeInViewport();
}

async function members(page: Page) {
  return reviewRoot(page)
    .locator("diffs-container[data-pier-file-path]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.getAttribute("data-pier-file-host"),
        path: element.getAttribute("data-pier-file-path"),
      }))
    );
}

async function expectConflictLines(page: Page, path: string): Promise<void> {
  const body = markerBody(page, path);
  await expect(body).toBeVisible({ timeout: 30_000 });
  await expect(
    body.locator("[data-line]").filter({ hasText: `current ${path}` })
  ).toBeVisible();
  await expect(
    body.locator("[data-line]").filter({ hasText: `incoming ${path}` })
  ).toBeVisible();
  await expect(
    body.getByRole("button", { name: ACCEPT_INCOMING })
  ).toBeEnabled();
}

async function expectResolved(
  fixture: ConflictFixture,
  path: string,
  text: string
): Promise<void> {
  await expect
    .poll(() => fixture.git("ls-files", "--unmerged", "--", path), {
      timeout: 20_000,
    })
    .toBe("");
  expect(readFileSync(join(fixture.repository, path), "utf8")).toBe(text);
  expect(await fixture.git("show", `:${path}`)).toBe(text);
}

/** Pause only the renderer's dispatched click; main/Git remain entirely real. */
async function acceptAfterExternalEdit(
  fixture: ConflictFixture,
  accept: Locator,
  path: string,
  externalText: string
): Promise<void> {
  await accept.scrollIntoViewIfNeeded();
  const box = await accept.boundingBox();
  if (!box) throw new Error("Expected visible Accept Incoming action");
  const session = await fixture.page.context().newCDPSession(fixture.page);
  let pauseTimer: NodeJS.Timeout | undefined;
  let click: Promise<void> | undefined;
  try {
    await session.send("Debugger.enable");
    const paused = new Promise<void>((resolve, reject) => {
      session.once("Debugger.paused", () => {
        clearTimeout(pauseTimer);
        resolve();
      });
      pauseTimer = setTimeout(
        () =>
          reject(
            new Error("Accept click did not reach the renderer breakpoint")
          ),
        10_000
      );
    });
    await session.send("DOMDebugger.setEventListenerBreakpoint", {
      eventName: "click",
    });
    click = fixture.page.mouse.click(
      box.x + box.width / 2,
      box.y + box.height / 2
    );
    // Retain the rejection for the awaited click without an unhandled rejection
    // if CDP is paused longer than the input command's lifetime.
    click.catch(() => undefined);
    await paused;
    // The original UI callback is already on the stack. Watch notifications
    // cannot replace its observed digest while renderer execution is paused.
    writeFileSync(join(fixture.repository, path), externalText);
    await session.send("DOMDebugger.removeEventListenerBreakpoint", {
      eventName: "click",
    });
    await session.send("Debugger.resume");
    await click;
  } finally {
    clearTimeout(pauseTimer);
    await session
      .send("DOMDebugger.removeEventListenerBreakpoint", { eventName: "click" })
      .catch(() => undefined);
    await session.send("Debugger.resume").catch(() => undefined);
    await session.detach();
    await click?.catch(() => undefined);
  }
}

test("keeps multiple UU conflicts in one continuous review, collapses independently, and saves/stages Incoming", async () => {
  test.setTimeout(120_000);
  await withConflictReview("markers", async (fixture) => {
    const { app, page, repository, git } = fixture;
    await expectConflictLines(page, "alpha.txt");
    await expectConflictLines(page, "beta.txt");
    await expect(markerBody(page, "alpha.txt")).toBeInViewport({ ratio: 0.2 });
    await expect(markerBody(page, "beta.txt")).toBeInViewport({ ratio: 0.2 });
    await expect(reviewRoot(page).locator(".cv-scrollbar")).toHaveCount(1);
    await expect(
      markerBody(page, "alpha.txt").locator(".cv-scrollbar")
    ).toHaveCount(0);
    await expect
      .poll(async () => (await members(page)).map((item) => item.path).sort())
      .toEqual(["alpha.txt", "beta.txt"]);
    const initialMembers = await members(page);
    await reviewRoot(page).evaluate((element) => {
      (element as HTMLElement).dataset.e2eConflictRoot = "continuous-conflicts";
    });
    for (const path of ["beta.txt", "alpha.txt", "beta.txt", "alpha.txt"]) {
      await navigateTo(page, path);
      await expect(reviewRoot(page)).toHaveAttribute(
        "data-e2e-conflict-root",
        "continuous-conflicts"
      );
      expect(await members(page)).toEqual(initialMembers);
    }
    const collapse = member(page, "alpha.txt").locator("button[aria-expanded]");
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "false");
    await expect(markerBody(page, "alpha.txt")).toBeHidden();
    await expectConflictLines(page, "beta.txt");
    expect(await members(page)).toEqual(initialMembers);
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expectConflictLines(page, "alpha.txt");

    for (const appearance of [
      {
        name: "light-wide",
        theme: { id: "light" as const, label: /Light|浅色/u },
        width: 1400,
      },
      {
        name: "dark-wide",
        theme: { id: "dark" as const, label: /Dark|深色/u },
        width: 1400,
      },
      {
        name: "dark-narrow",
        theme: { id: "dark" as const, label: /Dark|深色/u },
        width: 760,
      },
    ]) {
      await selectTheme(page, appearance.theme);
      await setWindowSize(app, page, appearance.width, 900);
      await navigateTo(page, "alpha.txt");
      await expectConflictLines(page, "alpha.txt");
      for (const path of ["alpha.txt", "beta.txt"]) {
        const title = member(page, path).locator(
          "[data-diffs-header] [data-title]"
        );
        await expect(title).toHaveText(path);
      }
      await test.info().attach(`conflicts-${appearance.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }

    // Shared Open File header chrome must target this file, not the last tree selection.
    await navigateTo(page, "alpha.txt");
    await member(page, "beta.txt")
      .locator("[data-diffs-header] [data-title]")
      .click();
    await expect(
      page.locator('[data-panel-tab-id^="pier.files.filePanel:disk:"]')
    ).toBeVisible({ timeout: 20_000 });
    const editor = page
      .getByTestId("files-code-mirror-editor")
      .locator(".cm-content");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).toContainText("current beta.txt");
    await expect(editor).toContainText("incoming beta.txt");
    const location = page.getByRole("navigation", {
      name: /File location|文件位置|ファイルの場所|파일 위치/u,
    });
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await chooseNativeMenu(fixture, location, COPY_PATH);
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(join(repository, "beta.txt"));
    const sourceTabId = await page
      .locator('[data-panel-tab-id^="pier.files.filePanel:disk:"]')
      .getAttribute("data-panel-tab-id");

    // The line context-menu path has its own resolver; exercise it with a
    // different tree selection too, including the nested UnresolvedFile host.
    await page.locator('[data-panel-tab-id^="pier.git.changes:"]').click();
    await navigateTo(page, "alpha.txt");
    await chooseNativeMenu(
      fixture,
      markerBody(page, "beta.txt")
        .locator("[data-line]")
        .filter({ hasText: "current beta.txt" }),
      JUMP_SOURCE
    );
    await expect(editor).toBeVisible();
    await expect(
      page.locator('[data-panel-tab-id^="pier.files.filePanel:disk:"]')
    ).toHaveCount(1);
    expect(
      await page
        .locator('[data-panel-tab-id^="pier.files.filePanel:disk:"]')
        .getAttribute("data-panel-tab-id")
    ).toBe(sourceTabId);
    await page.locator('[data-panel-tab-id^="pier.git.changes:"]').click();
    await navigateTo(page, "alpha.txt");
    await setWindowSize(app, page, 1400, 900);
    const betaBefore = readFileSync(join(repository, "beta.txt"), "utf8");
    const betaIndexBefore = await git(
      "ls-files",
      "--unmerged",
      "--",
      "beta.txt"
    );
    await markerBody(page, "alpha.txt")
      .getByRole("button", { name: ACCEPT_INCOMING })
      .click();
    await expectResolved(fixture, "alpha.txt", incomingText("alpha.txt"));
    await expect(member(page, "alpha.txt")).toHaveCount(0, { timeout: 20_000 });
    await expectConflictLines(page, "beta.txt");
    expect(readFileSync(join(repository, "beta.txt"), "utf8")).toBe(betaBefore);
    expect(await git("ls-files", "--unmerged", "--", "beta.txt")).toBe(
      betaIndexBefore
    );
    expect(await git("show", ":ordinary.txt")).toBe("ordinary base\n");
    await navigateTo(page, "ordinary.txt");
    await expect(member(page, "ordinary.txt")).toBeAttached();
    await navigateTo(page, "beta.txt");
    await expect(reviewRoot(page)).toHaveAttribute(
      "data-e2e-conflict-root",
      "continuous-conflicts"
    );
  });
});

test("resolves file-level deletion, incoming version, and reviewed text through the real native context menu", async () => {
  test.setTimeout(120_000);
  await withConflictReview("file-level", async (fixture) => {
    const { page, repository, git } = fixture;
    await navigateTo(page, "delete.txt");
    await expect(
      member(page, "delete.txt")
        .locator("[data-line]")
        .filter({ hasText: "current delete.txt" })
    ).toBeVisible();
    const deletedIndexBefore = await git(
      "ls-files",
      "--unmerged",
      "--",
      "delete.txt"
    );
    await chooseNativeMenu(
      fixture,
      member(page, "delete.txt").locator("[data-diffs-header] [data-title]"),
      CONFIRM_DELETE
    );
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("delete.txt");
    expect(readFileSync(join(repository, "delete.txt"), "utf8")).toBe(
      currentText("delete.txt")
    );
    expect(await git("ls-files", "--unmerged", "--", "delete.txt")).toBe(
      deletedIndexBefore
    );
    await confirm
      .getByRole("button", { name: /^(?:Cancel|取消|キャンセル|취소)$/u })
      .click();
    await expect(confirm).toBeHidden();
    expect(readFileSync(join(repository, "delete.txt"), "utf8")).toBe(
      currentText("delete.txt")
    );
    expect(await git("ls-files", "--unmerged", "--", "delete.txt")).toBe(
      deletedIndexBefore
    );
    await chooseNativeMenu(
      fixture,
      member(page, "delete.txt").locator("[data-diffs-header] [data-title]"),
      CONFIRM_DELETE
    );
    await confirm.getByRole("button", { name: CONFIRM_DELETE }).click();
    await expect(confirm).toBeHidden();
    await expect
      .poll(() => git("ls-files", "--stage", "--", "delete.txt"), {
        timeout: 20_000,
      })
      .toBe("");
    expect(() => readFileSync(join(repository, "delete.txt"))).toThrow();
    expect(
      (
        await git("diff", "--cached", "--name-status", "--", "delete.txt")
      ).trim()
    ).toBe("D\tdelete.txt");

    await navigateTo(page, "incoming.txt");
    await chooseNativeMenu(
      fixture,
      member(page, "incoming.txt").locator("[data-diffs-header] [data-title]"),
      TAKE_INCOMING
    );
    await expectResolved(fixture, "incoming.txt", incomingText("incoming.txt"));
    await navigateTo(page, "stage.txt");
    await expect(
      member(page, "stage.txt")
        .locator("[data-line]")
        .filter({ hasText: MANUAL_RESOLUTION.trim() })
    ).toBeVisible();
    await chooseNativeMenu(
      fixture,
      member(page, "stage.txt").locator("[data-diffs-header] [data-title]"),
      STAGE_CURRENT
    );
    await expectResolved(fixture, "stage.txt", MANUAL_RESOLUTION);
    expect(await git("ls-files", "--unmerged")).toBe("");
    expect(await git("show", ":ordinary.txt")).toBe("ordinary base\n");
    expect(readFileSync(join(repository, "ordinary.txt"), "utf8")).toBe(
      "ordinary working change\n"
    );
  });
});

test("rejects stale Accept Incoming visibly without overwriting an external edit or staging the conflict", async () => {
  test.setTimeout(120_000);
  await withConflictReview("markers", async (fixture) => {
    const { page, repository, git } = fixture;
    await expectConflictLines(page, "alpha.txt");
    const unmergedBefore = await git("ls-files", "--unmerged");
    const betaBefore = readFileSync(join(repository, "beta.txt"), "utf8");
    const externalText = "externally edited result; not the incoming version\n";
    await acceptAfterExternalEdit(
      fixture,
      markerBody(page, "alpha.txt").getByRole("button", {
        name: ACCEPT_INCOMING,
      }),
      "alpha.txt",
      externalText
    );
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(
      alert.getByRole("heading", { name: RESOLVE_FAILED })
    ).toBeVisible();
    await expect(alert).toContainText(
      /changed|updating|变化|更新|変更|변경|업데이트/iu
    );
    expect(readFileSync(join(repository, "alpha.txt"), "utf8")).toBe(
      externalText
    );
    expect(await git("ls-files", "--unmerged")).toBe(unmergedBefore);
    expect(readFileSync(join(repository, "beta.txt"), "utf8")).toBe(betaBefore);
    await test.info().attach("conflict-stale-rejection", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await alert.getByRole("button").click();
    await expect(alert).toBeHidden();
    // Check again after dismissal/refresh so an asynchronous stage cannot slip through.
    await navigateTo(page, "alpha.txt");
    await expect(
      member(page, "alpha.txt")
        .locator("[data-line]")
        .filter({ hasText: externalText.trim() })
    ).toBeVisible();
    expect(await git("ls-files", "--unmerged")).toBe(unmergedBefore);
    expect(readFileSync(join(repository, "alpha.txt"), "utf8")).toBe(
      externalText
    );
  });
});
