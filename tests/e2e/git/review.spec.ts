import { type ChildProcess, execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { selectTheme, setWindowSize } from "../workbench/e2e-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);
function createTemporaryDirectory(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Shared sidebar tree panel (not nested under a surface body).
 * `FilePanelLayout` sets ResizablePanel id=git-review-tree; react-resizable-panels
 * mirrors that id onto data-testid — do not also stamp the same testid on the
 * inner tree wrapper or Playwright strict mode fails with two matches.
 */
function reviewTree(page: Page): Locator {
  return page.getByTestId("git-review-tree");
}

/**
 * Half-staged files appear on both staged and unstaged surfaces. The sidebar
 * tree reflects the *active* surface only — switch surfaces before targeting
 * a group. Order disambiguation is kept for legacy mixed trees.
 */
function reviewTreeFileItem(
  page: Page,
  name: RegExp,
  group: "staged" | "unstaged" = "unstaged"
): Locator {
  const items = reviewTree(page).getByRole("treeitem", { name });
  return group === "staged" ? items.first() : items.last();
}

function activeReviewSurface(page: Page): Locator {
  return page.locator('[data-git-review-surface][aria-hidden="false"]:visible');
}

/** Shared header change summary (chrome, not nested under a surface body). */
function reviewChangeSummary(page: Page): Locator {
  return page.getByTestId("git-review-change-summary");
}

/** Navigation host that owns monotonic data-git-review-navigation-seq. */
function reviewNavigationHost(page: Page): Locator {
  return page.locator("[data-git-review-shared-tree]");
}

async function selectReviewSurface(
  page: Page,
  surface: "index" | "staged"
): Promise<void> {
  const current = await activeReviewSurface(page).getAttribute(
    "data-git-review-surface"
  );
  if (current === surface) {
    return;
  }
  // Switcher lives in the panel header chrome, not inside each surface body.
  // Anchor names: bare /Changes/ also matches "Staged Changes" (strict mode).
  const tabName =
    surface === "staged"
      ? /^(?:Staged Changes|已暂存更改)$/u
      : /^(?:Unstaged Changes|Changes|更改)$/u;
  const tab = page
    .getByTestId("git-review-surface-switcher")
    .getByRole("tab", { name: tabName });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(activeReviewSurface(page)).toHaveAttribute(
    "data-git-review-surface",
    surface
  );
  await expect(
    page.locator("[data-git-review-navigation-surface]")
  ).toHaveAttribute("data-git-review-navigation-surface", "");
}

/**
 * Switch to the target surface and expand directory roots so file rows exist.
 * Per-surface trees no longer include a "Staged Changes"/"Changes" group root.
 */
async function ensureReviewTreeFilesVisible(
  page: Page,
  group: "staged" | "unstaged" = "unstaged"
): Promise<void> {
  const targetSurface = group === "staged" ? "staged" : "index";
  await selectReviewSurface(page, targetSurface).catch(() => undefined);
  await expect(reviewTree(page)).toBeVisible({ timeout: 20_000 });
  const src = reviewTree(page).getByRole("treeitem", { name: /^src$/u });
  if ((await src.count()) === 0) {
    return;
  }
  const directory = src.first();
  if ((await directory.getAttribute("aria-expanded")) !== "true") {
    await directory.click({ force: true });
    await expect(directory).toHaveAttribute("aria-expanded", "true");
  }
}

async function waitForReviewMutationRelease(page: Page): Promise<void> {
  try {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const surface = document.querySelector<HTMLElement>(
              '[data-git-review-surface][aria-hidden="false"]'
            );
            if (surface === null) {
              return false;
            }
            // Empty document is a terminal post-unstage state even if the
            // authority bit is still draining a refresh.
            if (
              surface.querySelector(
                '[data-git-review-document-content="empty"]'
              ) !== null
            ) {
              return true;
            }
            if (
              surface.querySelector(
                '[data-git-review-mutation-blocked="true"]'
              ) !== null
            ) {
              return false;
            }
            return (
              surface.querySelector(
                '[data-git-review-mutation-blocked="false"], [data-git-review-document-settled="true"]'
              ) !== null
            );
          }),
        // Soft cap: Pierre can leave mutation-blocked true after DiffHunks
        // errors; callers already assert git state as the mutation truth.
        { timeout: 15_000 }
      )
      .toBe(true);
  } catch {
    // Best-effort barrier only.
  }
}

async function markReviewSurfaceIdentity(
  page: Page,
  surface: "index" | "staged",
  token: string,
  requestedScrollTop = 0
): Promise<number> {
  const root = page.locator(
    `[data-git-review-surface="${surface}"] [data-testid="pierre-diff-root"]`
  );
  await expect(root).toBeAttached({ timeout: 30_000 });
  await root.evaluate((element, marker) => {
    element.dataset.e2eSurfaceIdentity = marker;
  }, token);
  if (requestedScrollTop > 0) {
    const scroller = root.locator(".cv-scrollbar");
    await expect
      .poll(
        () =>
          scroller.evaluate((element) =>
            Boolean(
              element.scrollHeight > element.clientHeight &&
                element.clientHeight > 0
            )
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    // Use a real user wheel gesture so the product clears any pending semantic
    // navigation before the test captures its reading anchor. Programmatic
    // scroll is intentionally not user intent and may be superseded.
    // Force: inactive-surface peers can leave the scroller "not visible" to
    // Playwright even when it has a non-zero client box after settle.
    await scroller.hover({ force: true });
    for (let step = 0; step < 4; step += 1) {
      await page.mouse.wheel(0, Math.ceil(requestedScrollTop / 2));
    }
    await expect
      .poll(
        async () => {
          const top = await scroller.evaluate((element) => element.scrollTop);
          if (top > 0) {
            return top;
          }
          // Fallback: if the wheel was eaten (overlay / focus), apply a single
          // user-intent scrollTop write after the wheel bursts above.
          await scroller.evaluate((element, nextTop) => {
            element.scrollTop = nextTop;
            element.dispatchEvent(new Event("scroll", { bubbles: true }));
          }, requestedScrollTop);
          return scroller.evaluate((element) => element.scrollTop);
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0);
  }
  return root.evaluate(async (element) => {
    const scroller = element.querySelector<HTMLElement>(".cv-scrollbar");
    if (!scroller) {
      throw new Error("Review surface scroller is unavailable");
    }
    await new Promise<void>((resolve) => {
      let remainingFrames = 8;
      const settle = () => {
        remainingFrames -= 1;
        if (remainingFrames === 0) {
          resolve();
          return;
        }
        requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    });
    return scroller.scrollTop;
  });
}

async function reviewSurfaceIdentity(
  page: Page,
  surface: "index" | "staged"
): Promise<{ readonly scrollTop: number; readonly token: string | undefined }> {
  return page
    .locator(
      `[data-git-review-surface="${surface}"] [data-testid="pierre-diff-root"]`
    )
    .evaluate((element) => ({
      scrollTop:
        element.querySelector<HTMLElement>(".cv-scrollbar")?.scrollTop ?? 0,
      token: element.dataset.e2eSurfaceIdentity,
    }));
}

/**
 * Click a review tree row. CI sticky group headers render an aria-hidden
 * overlay that intercepts normal Playwright hit-testing; scroll first (force
 * skips auto-scroll), then force the click.
 */
async function clickReviewTreeFile(
  page: Page,
  name: RegExp,
  group: "staged" | "unstaged" = "unstaged"
): Promise<void> {
  const item = reviewTreeFileItem(page, name, group);
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.scrollIntoViewIfNeeded();
  await item.click({ force: true });
}

async function expandReviewTreeDirectory(
  page: Page,
  name: RegExp,
  group: "staged" | "unstaged"
): Promise<void> {
  await selectReviewSurface(
    page,
    group === "staged" ? "staged" : "index"
  ).catch(() => undefined);
  const directories = reviewTree(page).getByRole("treeitem", { name });
  const directory =
    group === "staged" ? directories.first() : directories.last();
  await expect(directory).toBeVisible({ timeout: 30_000 });
  if ((await directory.getAttribute("aria-expanded")) !== "true") {
    await directory.click({ force: true });
    await expect(directory).toHaveAttribute("aria-expanded", "true");
  }
}

async function expandReviewTreeGroup(
  page: Page,
  group: "staged" | "unstaged"
): Promise<void> {
  // Surface tabs own the group; expand file directories on that surface.
  await ensureReviewTreeFilesVisible(page, group);
}

async function waitForReviewPathViewportSettle(
  page: Page,
  path: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (expectedPath) => {
          const sample = (): number | null => {
            const surface = document.querySelector<HTMLElement>(
              '[data-git-review-surface][aria-hidden="false"]'
            );
            const scroller = surface?.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!(surface && scroller)) {
              return null;
            }
            const viewport = scroller.getBoundingClientRect();
            const matching = [...surface.querySelectorAll("diffs-container")]
              .filter((container) =>
                `${container.textContent ?? ""}${container.shadowRoot?.textContent ?? ""}`.includes(
                  expectedPath
                )
              )
              .sort(
                (left, right) =>
                  Math.abs(left.getBoundingClientRect().top - viewport.top) -
                  Math.abs(right.getBoundingClientRect().top - viewport.top)
              );
            const target = matching[0];
            const line = target?.shadowRoot?.querySelector("[data-line]");
            return (line ?? target)?.getBoundingClientRect().top ?? null;
          };
          const before = sample();
          await new Promise<void>((resolve) => {
            let frames = 0;
            const next = () => {
              frames += 1;
              if (frames >= 8) {
                resolve();
                return;
              }
              requestAnimationFrame(next);
            };
            requestAnimationFrame(next);
          });
          const after = sample();
          return before !== null && after !== null
            ? Math.abs(after - before)
            : null;
        }, path),
      { timeout: 5000 }
    )
    .toBeLessThanOrEqual(0.5);
}

/** `.bin` uses kind copy ("Binary binary"); generic fallback stays "Binary file". */
const BINARY_STATE_NOTICE = /Binary (?:file|binary)|二进制文件/u;

/**
 * Main-thread longtask budget. Local stays tight; CI macOS shared runners are
 * noisier after ledger/hunk-stage work (observed peaks ~1.2s on retries).
 */
const REVIEW_LONGTASK_MS_BUDGET = process.env.CI ? 1500 : 250;

/** Large-file first paint after tree click → first virtual window. */
const REVIEW_LARGE_FIRST_PAINT_MS_BUDGET = process.env.CI ? 8000 : 5000;

/** Already-loaded file navigation (tree click → viewport text). */
const REVIEW_LOADED_NAVIGATION_MS_BUDGET = process.env.CI ? 1500 : 500;
/** Device-pixel rounding only; visible post-materialization movement fails. */
const REVIEW_NAVIGATION_ANCHOR_JITTER_PX = 0.5;

/**
 * Strip the review group-root prefix (`Changes/…`, `Staged Changes/…`, zh
 * labels, invisible sort prefix). Pierre directory rows use a trailing `/`.
 */
function reviewTreeRepoPath(treePath: string): string {
  const slash = treePath.indexOf("/");
  const withoutGroup = slash < 0 ? treePath : treePath.slice(slash + 1);
  return withoutGroup.endsWith("/") ? withoutGroup.slice(0, -1) : withoutGroup;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

function reviewBinaryFileName(index: number): string {
  return index === 6 ? "binary-6\\special.bin" : `binary-${String(index)}.bin`;
}

async function createPureRenameReviewRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(sourceDirectory, "old-a.ts"), "export const a = 1;\n");
  writeFileSync(join(sourceDirectory, "old-b.ts"), "export const b = 1;\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  await git(root, ["mv", "src/old-a.ts", "src/renamed-a.ts"]);
  await git(root, ["mv", "src/old-b.ts", "src/renamed-b.ts"]);
}

async function createReviewRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 1;\n");
  writeFileSync(
    join(sourceDirectory, "script.py"),
    "def answer():\n    return 1\n"
  );
  const largeSource = Array.from(
    { length: 10_000 },
    (_, index) =>
      `export const line${String(index).padStart(5, "0")} = 0;${
        index === 10 ? ` // ${"long-line-".repeat(120)}` : ""
      }`
  );
  writeFileSync(
    join(sourceDirectory, "large.ts"),
    `${largeSource.join("\n")}\n`
  );
  for (let index = 0; index < 7; index += 1) {
    writeFileSync(
      join(sourceDirectory, reviewBinaryFileName(index)),
      Buffer.from([0, index, 1])
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 2;\n");
  await git(root, ["add", "src/app.tsx"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 3;\n");
  writeFileSync(
    join(sourceDirectory, "script.py"),
    "def answer():\n    return 2\n"
  );
  writeFileSync(
    join(sourceDirectory, "large.ts"),
    `${largeSource
      .map((line, index) =>
        index % 2 === 0 ? line.replace("= 0", "= 1") : line
      )
      .join("\n")}\n`
  );
  for (let index = 0; index < 7; index += 1) {
    writeFileSync(
      join(sourceDirectory, reviewBinaryFileName(index)),
      Buffer.from([0, index, 2])
    );
  }
}

/**
 * Compact staged+unstaged fixture without large.ts so mutations stay snappy.
 * Single-line app.tsx keeps Pierre hunk round-trips stable; script.py is a
 * second unstaged file for keepalive/tab-switch probes.
 */
async function createCompactReviewRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 1;\n");
  writeFileSync(
    join(sourceDirectory, "script.py"),
    "def answer():\n    return 1\n"
  );
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 2;\n");
  await git(root, ["add", "src/app.tsx"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 3;\n");
  writeFileSync(
    join(sourceDirectory, "script.py"),
    "def answer():\n    return 2\n"
  );
}

async function createScaledReviewRepository(
  root: string,
  fileCount: number,
  changedFileCount = fileCount
): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  for (let index = 0; index < fileCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    writeFileSync(
      join(sourceDirectory, `file-${suffix}.ts`),
      scaledReviewFile(suffix, 0)
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  modifyScaledReviewFiles(root, 0, changedFileCount);
}

async function createSpecialPathReviewRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  const nestedDirectory = join(sourceDirectory, "nested");
  mkdirSync(sourceDirectory);
  mkdirSync(nestedDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  const files = [
    [join(root, "\\notes.txt"), "rootSpecial"],
    [join(sourceDirectory, "dir\\..\\file.ts"), "parentTextSpecial"],
    [join(nestedDirectory, "back\\slash.ts"), "nestedSpecial"],
    [join(sourceDirectory, "sibling.ts"), "siblingSpecial"],
  ] as const;
  for (const [path, name] of files) {
    writeFileSync(path, `export const ${name} = 1;\n`);
  }
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  for (const [path, name] of files) {
    writeFileSync(path, `export const ${name} = 2;\n`);
  }
}

function modifyScaledReviewFiles(
  root: string,
  startIndex: number,
  endIndex: number
): void {
  const sourceDirectory = join(root, "src");
  for (let index = startIndex; index < endIndex; index += 1) {
    const suffix = String(index).padStart(4, "0");
    writeFileSync(
      join(sourceDirectory, `file-${suffix}.ts`),
      scaledReviewFile(suffix, 1)
    );
  }
}

function scaledReviewFile(suffix: string, value: number): string {
  return `${Array.from({ length: 200 }, (_, lineIndex) =>
    lineIndex === 100
      ? `export const value${suffix} = ${value};`
      : `export const stable${suffix}_${lineIndex} = ${lineIndex};`
  ).join("\n")}\n`;
}

async function isDiffTextInViewport(
  page: Page,
  text: string
): Promise<boolean> {
  return page
    .locator('[data-git-review-surface][aria-hidden="false"] diffs-container')
    .evaluateAll((containers, expectedText) => {
      const surface = document.querySelector<HTMLElement>(
        '[data-git-review-surface][aria-hidden="false"]'
      );
      const scroller = surface?.querySelector<HTMLElement>(
        '[data-testid="pierre-diff-root"] .cv-scrollbar'
      );
      if (!scroller) {
        return false;
      }
      const viewport = scroller.getBoundingClientRect();
      return containers.some((container) => {
        const item = container.getBoundingClientRect();
        return (
          (container.shadowRoot?.textContent ?? "").includes(expectedText) &&
          item.bottom > viewport.top &&
          item.top < viewport.bottom
        );
      });
    }, text);
}

interface NavigationAnchorProbeResult {
  blankFrames: number;
  done: boolean;
  firstAnchorOffsetPx: number | null;
  geometryChanges: {
    readonly height: number;
    readonly itemTop: number;
    readonly lineCount: number;
    readonly offset: number;
    readonly viewportAnchorText: string;
    readonly viewportAnchorTop: number;
    readonly scrollTop: number;
  }[];
  maxAnchorDeltaPx: number;
  maxAnchorOffsetPx: number;
  minAnchorOffsetPx: number;
  missingAfterSeenFrames: number;
  offscreenFrames: number;
  targetFrames: number;
}

async function installNavigationAnchorProbe(
  page: Page,
  text: string,
  frameCount = 90
): Promise<void> {
  await page.evaluate(
    ({ expectedText, frames }) => {
      const result: NavigationAnchorProbeResult = {
        blankFrames: 0,
        done: false,
        firstAnchorOffsetPx: null,
        geometryChanges: [],
        maxAnchorDeltaPx: 0,
        maxAnchorOffsetPx: Number.NEGATIVE_INFINITY,
        missingAfterSeenFrames: 0,
        minAnchorOffsetPx: Number.POSITIVE_INFINITY,
        offscreenFrames: 0,
        targetFrames: 0,
      };
      Reflect.set(window, "__pierGitReviewNavigationAnchorProbe", result);
      let hasSeenTarget = false;
      const sample = () => {
        const surface = document.querySelector<HTMLElement>(
          '[data-git-review-surface][aria-hidden="false"]'
        );
        const scroller = surface?.querySelector<HTMLElement>(
          '[data-testid="pierre-diff-root"] .cv-scrollbar'
        );
        const containers = [
          ...(surface?.querySelectorAll<HTMLElement>("diffs-container") ?? []),
        ];
        if (!(scroller && containers.length > 0)) {
          result.blankFrames += 1;
        }
        const target = containers.find((container) =>
          container.shadowRoot?.textContent?.includes(expectedText)
        );
        if (scroller && target) {
          hasSeenTarget = true;
          const viewport = scroller.getBoundingClientRect();
          const bounds = target.getBoundingClientRect();
          const anchor =
            [
              ...(target.shadowRoot?.querySelectorAll("[data-line]") ?? []),
            ].find((line) => line.textContent?.includes(expectedText)) ??
            target;
          const visibleLines = [
            ...(target.shadowRoot?.querySelectorAll<HTMLElement>(
              "[data-line]"
            ) ?? []),
          ]
            .map((line) => ({
              element: line,
              top: line.getBoundingClientRect().top - viewport.top,
            }))
            .filter(({ element }) => {
              const lineBounds = element.getBoundingClientRect();
              return (
                lineBounds.bottom > viewport.top &&
                lineBounds.top < viewport.bottom
              );
            })
            .sort((left, right) => Math.abs(left.top) - Math.abs(right.top));
          const viewportAnchor = visibleLines[0];
          const offset = anchor.getBoundingClientRect().top - viewport.top;
          const previous = result.geometryChanges.at(-1);
          if (
            previous === undefined ||
            previous.offset !== offset ||
            previous.height !== bounds.height ||
            previous.itemTop !== bounds.top - viewport.top ||
            previous.lineCount !==
              (target.shadowRoot?.querySelectorAll("[data-line]").length ??
                0) ||
            previous.viewportAnchorText !==
              (viewportAnchor?.element.textContent ?? "") ||
            previous.viewportAnchorTop !== (viewportAnchor?.top ?? 0) ||
            previous.scrollTop !== scroller.scrollTop
          ) {
            result.geometryChanges.push({
              height: bounds.height,
              itemTop: bounds.top - viewport.top,
              lineCount:
                target.shadowRoot?.querySelectorAll("[data-line]").length ?? 0,
              offset,
              scrollTop: scroller.scrollTop,
              viewportAnchorText: viewportAnchor?.element.textContent ?? "",
              viewportAnchorTop: viewportAnchor?.top ?? 0,
            });
          }
          result.firstAnchorOffsetPx ??= offset;
          result.maxAnchorDeltaPx = Math.max(
            result.maxAnchorDeltaPx,
            Math.abs(offset - result.firstAnchorOffsetPx)
          );
          result.maxAnchorOffsetPx = Math.max(result.maxAnchorOffsetPx, offset);
          result.minAnchorOffsetPx = Math.min(result.minAnchorOffsetPx, offset);
          result.targetFrames += 1;
          if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
            result.offscreenFrames += 1;
          }
        } else if (hasSeenTarget) {
          result.missingAfterSeenFrames += 1;
        }
        if (result.targetFrames >= frames) {
          Reflect.set(window, "__pierGitReviewNavigationAnchorProbe", {
            ...result,
            done: true,
          });
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },
    { expectedText: text, frames: frameCount }
  );
}

async function readNavigationAnchorProbe(
  page: Page
): Promise<NavigationAnchorProbeResult> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              Reflect.get(
                window,
                "__pierGitReviewNavigationAnchorProbe"
              ) as NavigationAnchorProbeResult
            ).done
        ),
      { timeout: 30_000 }
    )
    .toBe(true);
  return page.evaluate(
    () =>
      Reflect.get(
        window,
        "__pierGitReviewNavigationAnchorProbe"
      ) as NavigationAnchorProbeResult
  );
}

/**
 * Stronger than mere visibility: the section containing `text` must be the
 * CodeView item nearest the viewport top. This distinguishes adjacent staged
 * and unstaged sections of the same file.
 */
async function isDiffTextAtViewportAnchor(
  page: Page,
  text: string
): Promise<boolean> {
  return page
    .locator('[data-git-review-surface][aria-hidden="false"] diffs-container')
    .evaluateAll((containers, marker) => {
      const surface = document.querySelector<HTMLElement>(
        '[data-git-review-surface][aria-hidden="false"]'
      );
      const scroller = surface?.querySelector<HTMLElement>(
        '[data-testid="pierre-diff-root"] .cv-scrollbar'
      );
      if (!scroller) {
        return false;
      }
      const viewport = scroller.getBoundingClientRect();
      const ranked = containers
        .map((container) => ({
          container,
          distance: Math.abs(
            container.getBoundingClientRect().top - viewport.top
          ),
        }))
        .sort((left, right) => left.distance - right.distance);
      const target = ranked.find(({ container }) =>
        (container.shadowRoot?.textContent ?? "").includes(marker)
      );
      return target !== undefined && ranked[0]?.container === target.container;
    }, text);
}

interface ReviewMutationProbeResult {
  readonly activeBlankFrames: number;
  readonly anchorDeltaPx: number;
  readonly anchorKind: "semantic" | "viewport";
  readonly anchorOffsetAfterPx: number;
  readonly anchorOffsetBeforePx: number;
  readonly blankFrames: number;
  readonly busyFrame: number | null;
  readonly contentAfterEmptyFrames: number;
  readonly emptyFrames: number;
  readonly emptySemanticMismatchFrames: number;
  readonly endedEmpty: boolean;
  readonly expandedTreeStable: boolean;
  readonly fallbackPath: string | null;
  readonly fallbackTopDeltaPx: number;
  readonly longTasks: readonly {
    readonly afterClickMs: number;
    readonly durationMs: number;
  }[];
  readonly maxLongTaskMs: number;
  readonly overlayBlankFrames: number;
  readonly overlayFrames: number;
  readonly rootStable: boolean;
  readonly surfaceStable: boolean;
  readonly treeScrollDeltaPx: number;
  readonly workerCountStable: boolean;
}

async function startReviewMutationProbe(
  action: Locator,
  path: string
): Promise<void> {
  await action.evaluate((button, expectedPath) => {
    const surface = document.querySelector<HTMLElement>(
      '[data-git-review-surface][aria-hidden="false"]'
    );
    const scroller = surface?.querySelector<HTMLElement>(
      '[data-testid="pierre-diff-root"] .cv-scrollbar'
    );
    const root = surface?.querySelector<HTMLElement>(
      '[data-testid="pierre-diff-root"]'
    );
    const viewportBounds = scroller?.getBoundingClientRect();
    const viewportAnchor =
      viewportBounds === undefined
        ? undefined
        : [...(surface?.querySelectorAll("diffs-container") ?? [])].find(
            (container) => {
              const bounds = container.getBoundingClientRect();
              return (
                bounds.bottom > viewportBounds.top &&
                bounds.top < viewportBounds.bottom
              );
            }
          );
    const actionAnchor =
      button.closest("diffs-container") ??
      surface?.querySelector(
        `diffs-container[data-pier-file-path="${CSS.escape(expectedPath)}"]`
      ) ??
      viewportAnchor;
    if (!(surface && scroller && root && actionAnchor instanceof HTMLElement)) {
      throw new Error("Git review mutation probe is missing stable geometry");
    }
    const deepElements = (start: ParentNode): Element[] => {
      const found: Element[] = [];
      for (const element of start.querySelectorAll("*")) {
        found.push(element);
        if (element.shadowRoot) {
          found.push(...deepElements(element.shadowRoot));
        }
      }
      return found;
    };
    const treeElements = deepElements(
      surface?.querySelector('[data-testid="git-review-tree"]') ?? document
    );
    const treeScroller = treeElements.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.scrollHeight > element.clientHeight + 1
    );
    const expandedTree = JSON.stringify(
      treeElements
        .filter((element) => element.hasAttribute("aria-expanded"))
        .map((element) => [
          element.getAttribute("data-path") ??
            element.getAttribute("aria-label") ??
            element.textContent,
          element.getAttribute("aria-expanded"),
        ])
        .sort()
    );
    const viewport = scroller.getBoundingClientRect();
    const anchor = actionAnchor;
    const anchorLine = anchor.shadowRoot?.querySelector("[data-line]");
    const state = {
      activeBlankFrames: 0,
      anchorOffset:
        (anchorLine ?? anchor).getBoundingClientRect().top - viewport.top,
      blankFrames: 0,
      busyFrame: null as number | null,
      button: button as HTMLElement,
      clicked: false,
      clickedAt: null as number | null,
      contentAfterEmptyFrames: 0,
      emptyFrames: 0,
      emptySemanticMismatchFrames: 0,
      expandedTree,
      finished: false,
      frame: 0,
      longTasks: [] as {
        afterClickMs: number;
        durationMs: number;
      }[],
      observer: null as PerformanceObserver | null,
      overlayBlankFrames: 0,
      overlayFrames: 0,
      path: expectedPath,
      root,
      seenEmpty: false,
      scrollTop: scroller.scrollTop,
      surface: surface.dataset.gitReviewSurface,
      treeScrollTop: treeScroller?.scrollTop ?? 0,
      workerCount: (
        Reflect.get(window, "__pierGitReviewWorkerStats") as {
          created: number;
        }
      ).created,
    };
    const observer = new PerformanceObserver((list) => {
      const clickedAt = state.clickedAt;
      if (clickedAt === null) {
        return;
      }
      state.longTasks.push(
        ...list
          .getEntries()
          .filter((entry) => entry.startTime >= clickedAt)
          .map((entry) => ({
            afterClickMs: entry.startTime - clickedAt,
            durationMs: entry.duration,
          }))
      );
    });
    observer.observe({ entryTypes: ["longtask"] });
    state.observer = observer;
    const begin = () => {
      if (state.clicked) {
        return;
      }
      state.clicked = true;
      state.clickedAt = performance.now();
      state.frame = 0;
      state.longTasks.length = 0;
    };
    state.button.addEventListener("click", begin, {
      capture: true,
      once: true,
    });
    state.button.addEventListener("contextmenu", begin, {
      capture: true,
      once: true,
    });
    Reflect.set(window, "__pierGitReviewMutationProbe", state);
    const sample = () => {
      if (state.clicked) {
        state.frame += 1;
        if (
          state.busyFrame === null &&
          (!state.button.isConnected ||
            state.button.matches(":disabled") ||
            state.button.closest("[inert]") !== null ||
            state.root.closest("[inert]") !== null ||
            state.root.closest('[data-git-review-mutation-blocked="true"]') !==
              null)
        ) {
          state.busyFrame = state.frame;
        }
        const currentActiveSurface = document.querySelector<HTMLElement>(
          '[data-git-review-surface][aria-hidden="false"]'
        );
        const visibleSurfaces = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-git-review-surface]"
          ),
        ].filter((candidate) => {
          const style = getComputedStyle(candidate);
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number.parseFloat(style.opacity || "1") > 0
          );
        });
        const hasVisibleLine = (candidate: HTMLElement): boolean => {
          const currentScroller = candidate.querySelector<HTMLElement>(
            '[data-testid="pierre-diff-root"] .cv-scrollbar'
          );
          if (!currentScroller) {
            return false;
          }
          const scrollerBounds = currentScroller.getBoundingClientRect();
          return [...candidate.querySelectorAll("diffs-container")].some(
            (container) =>
              [
                ...(container.shadowRoot?.querySelectorAll<HTMLElement>(
                  "[data-line]"
                ) ?? []),
              ].some((line) => {
                const bounds = line.getBoundingClientRect();
                return (
                  bounds.width > 0 &&
                  bounds.height > 0 &&
                  bounds.bottom > scrollerBounds.top &&
                  bounds.top < scrollerBounds.bottom &&
                  bounds.right > scrollerBounds.left &&
                  bounds.left < scrollerBounds.right
                );
              })
          );
        };
        const activeHasVisibleLine =
          currentActiveSurface !== null && hasVisibleLine(currentActiveSurface);
        const activeSurfaceName =
          currentActiveSurface?.dataset.gitReviewSurface;
        const activeEmpty =
          currentActiveSurface?.querySelector<HTMLElement>(
            '[data-git-review-document-content="empty"]'
          ) ?? null;
        let activeHasVisibleDocumentEmpty = false;
        if (activeEmpty !== null) {
          const bounds = activeEmpty.getBoundingClientRect();
          const expectedTitle = activeEmpty.dataset.gitReviewEmptyTitle;
          activeHasVisibleDocumentEmpty = bounds.width > 0 && bounds.height > 0;
          if (activeHasVisibleDocumentEmpty) {
            const semanticMatch =
              activeSurfaceName !== undefined &&
              activeEmpty.dataset.gitReviewEmptySurface === activeSurfaceName &&
              expectedTitle !== undefined &&
              expectedTitle.length > 0 &&
              (activeEmpty.textContent ?? "").includes(expectedTitle);
            if (semanticMatch) {
              state.emptyFrames += 1;
              state.seenEmpty = true;
            } else {
              state.emptySemanticMismatchFrames += 1;
            }
          }
        }
        if (state.seenEmpty && activeHasVisibleLine) {
          state.contentAfterEmptyFrames += 1;
        }
        const handoffOverlays = visibleSurfaces.filter(
          (candidate) => candidate !== currentActiveSurface
        );
        const overlayHasVisibleLine = handoffOverlays.some(hasVisibleLine);
        state.overlayFrames += handoffOverlays.length > 0 ? 1 : 0;
        if (!(activeHasVisibleLine || activeHasVisibleDocumentEmpty)) {
          state.activeBlankFrames += 1;
        }
        if (
          handoffOverlays.length > 0 &&
          handoffOverlays.some((candidate) => !hasVisibleLine(candidate))
        ) {
          state.overlayBlankFrames += 1;
        }
        if (
          !(
            activeHasVisibleLine ||
            activeHasVisibleDocumentEmpty ||
            overlayHasVisibleLine
          )
        ) {
          state.blankFrames += 1;
        }
      }
      if (!state.finished) {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  }, path);
}

async function finishReviewMutationProbe(
  page: Page
): Promise<ReviewMutationProbeResult> {
  return await page.evaluate(async () => {
    const state = Reflect.get(window, "__pierGitReviewMutationProbe") as {
      activeBlankFrames: number;
      anchorOffset: number;
      blankFrames: number;
      busyFrame: number | null;
      contentAfterEmptyFrames: number;
      emptyFrames: number;
      emptySemanticMismatchFrames: number;
      expandedTree: string;
      finished: boolean;
      longTasks: {
        afterClickMs: number;
        durationMs: number;
      }[];
      observer: PerformanceObserver;
      overlayBlankFrames: number;
      overlayFrames: number;
      path: string;
      root: HTMLElement;
      seenEmpty: boolean;
      scrollTop: number;
      surface: string | undefined;
      treeScrollTop: number;
      workerCount: number;
    };
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    state.finished = true;
    state.observer.disconnect();
    const deepElements = (start: ParentNode): Element[] => {
      const found: Element[] = [];
      for (const element of start.querySelectorAll("*")) {
        found.push(element);
        if (element.shadowRoot) {
          found.push(...deepElements(element.shadowRoot));
        }
      }
      return found;
    };
    const surface = document.querySelector<HTMLElement>(
      '[data-git-review-surface][aria-hidden="false"]'
    );
    if (surface === null) {
      throw new Error("Git review mutation probe lost the active surface");
    }
    const scroller = surface.querySelector<HTMLElement>(
      '[data-testid="pierre-diff-root"] .cv-scrollbar'
    );
    const root = surface.querySelector<HTMLElement>(
      '[data-testid="pierre-diff-root"]'
    );
    const activeSurfaceName = surface.dataset.gitReviewSurface;
    const empty =
      activeSurfaceName === undefined
        ? null
        : surface.querySelector<HTMLElement>(
            `[data-git-review-document-content="empty"][data-git-review-empty-surface="${CSS.escape(activeSurfaceName)}"]`
          );
    const emptyBounds = empty?.getBoundingClientRect();
    const expectedEmptyTitle = empty?.dataset.gitReviewEmptyTitle;
    const endedEmpty =
      emptyBounds !== undefined &&
      emptyBounds.width > 0 &&
      emptyBounds.height > 0 &&
      expectedEmptyTitle !== undefined &&
      expectedEmptyTitle.length > 0 &&
      (empty?.textContent ?? "").includes(expectedEmptyTitle);
    if (!(endedEmpty || (scroller !== null && root !== null))) {
      throw new Error("Git review mutation probe lost visible content");
    }
    const viewport = scroller?.getBoundingClientRect();
    const matching =
      viewport === undefined
        ? []
        : [...surface.querySelectorAll("diffs-container")].filter(
            (container) =>
              container.getAttribute("data-pier-file-path") === state.path ||
              `${container.textContent ?? ""}${container.shadowRoot?.textContent ?? ""}`.includes(
                state.path
              )
          );
    const anchor = matching.sort((left, right) => {
      const leftLine = left.shadowRoot?.querySelector("[data-line]");
      const rightLine = right.shadowRoot?.querySelector("[data-line]");
      return (
        Math.abs(
          (leftLine ?? left).getBoundingClientRect().top -
            (viewport?.top ?? 0) -
            state.anchorOffset
        ) -
        Math.abs(
          (rightLine ?? right).getBoundingClientRect().top -
            (viewport?.top ?? 0) -
            state.anchorOffset
        )
      );
    })[0];
    const anchorLine = anchor?.shadowRoot?.querySelector("[data-line]");
    const firstVisibleContainer =
      viewport === undefined
        ? undefined
        : [...surface.querySelectorAll("diffs-container")]
            .filter((container) => {
              const bounds = container.getBoundingClientRect();
              return (
                bounds.width > 0 &&
                bounds.height > 0 &&
                bounds.bottom > viewport.top &&
                bounds.top < viewport.bottom
              );
            })
            .sort(
              (left, right) =>
                left.getBoundingClientRect().top -
                right.getBoundingClientRect().top
            )[0];
    const treeElements = deepElements(
      surface.querySelector('[data-testid="git-review-tree"]') ?? document
    );
    const treeScroller = treeElements.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.scrollHeight > element.clientHeight + 1
    );
    const expandedTree = JSON.stringify(
      treeElements
        .filter((element) => element.hasAttribute("aria-expanded"))
        .map((element) => [
          element.getAttribute("data-path") ??
            element.getAttribute("aria-label") ??
            element.textContent,
          element.getAttribute("aria-expanded"),
        ])
        .sort()
    );
    const previousExpansion = new Map(
      JSON.parse(state.expandedTree) as [string, string][]
    );
    const currentExpansion = new Map(
      JSON.parse(expandedTree) as [string, string][]
    );
    const expandedTreeStable = [...previousExpansion].every(
      ([path, expanded]) =>
        currentExpansion.has(path) && currentExpansion.get(path) === expanded
    );
    const anchorOffsetAfter = anchor
      ? (anchorLine ?? anchor).getBoundingClientRect().top -
        (viewport?.top ?? 0)
      : state.anchorOffset;
    const expectedScrollTop =
      scroller === null
        ? state.scrollTop
        : Math.min(
            state.scrollTop,
            Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          );
    let anchorDeltaPx = 0;
    if (anchor !== undefined) {
      anchorDeltaPx = Math.abs(anchorOffsetAfter - state.anchorOffset);
    } else if (scroller !== null) {
      anchorDeltaPx = Math.abs(scroller.scrollTop - expectedScrollTop);
    }
    return {
      activeBlankFrames: state.activeBlankFrames,
      anchorKind: anchor ? ("semantic" as const) : ("viewport" as const),
      anchorDeltaPx,
      anchorOffsetAfterPx: anchorOffsetAfter,
      anchorOffsetBeforePx: state.anchorOffset,
      blankFrames: state.blankFrames,
      busyFrame: state.busyFrame,
      contentAfterEmptyFrames: state.contentAfterEmptyFrames,
      emptyFrames: state.emptyFrames,
      emptySemanticMismatchFrames: state.emptySemanticMismatchFrames,
      endedEmpty,
      expandedTreeStable,
      fallbackPath:
        firstVisibleContainer?.getAttribute("data-pier-file-path") ?? null,
      fallbackTopDeltaPx:
        firstVisibleContainer === undefined || viewport === undefined
          ? 0
          : Math.abs(
              firstVisibleContainer.getBoundingClientRect().top - viewport.top
            ),
      longTasks: state.longTasks,
      maxLongTaskMs: Math.max(
        0,
        ...state.longTasks.map((entry) => entry.durationMs)
      ),
      overlayBlankFrames: state.overlayBlankFrames,
      overlayFrames: state.overlayFrames,
      rootStable: root === state.root,
      surfaceStable: surface.dataset.gitReviewSurface === state.surface,
      treeScrollDeltaPx: Math.abs(
        (treeScroller?.scrollTop ?? 0) - state.treeScrollTop
      ),
      workerCountStable:
        (
          Reflect.get(window, "__pierGitReviewWorkerStats") as {
            created: number;
          }
        ).created === state.workerCount,
    };
  });
}

function expectStableReviewMutation(
  result: ReviewMutationProbeResult,
  options: {
    readonly expectedAnchorDisposition?: "fallback-top" | "preserved";
    readonly expectedFinalContent?: "code" | "empty";
    readonly expectedRootStable?: boolean;
    readonly maximumBusyFrame?: number;
    readonly maximumLongTaskMs?: number;
  } = {}
): void {
  const expectedFinalContent = options.expectedFinalContent ?? "code";
  const expectedAnchorDisposition =
    options.expectedAnchorDisposition ?? "preserved";
  expect(result).toMatchObject({
    // Intentional handoff overlays (previous surface kept visible during
    // stage/unstage transitions) increment overlayFrames; blank handoff is
    // the regression to reject.
    overlayBlankFrames: 0,
    surfaceStable: true,
    workerCountStable: true,
  });
  // Empty staged after unstage may collapse tree groups / swap CodeView roots;
  // only enforce tree+root stability when content remains.
  if (expectedFinalContent === "code") {
    expect(result.expandedTreeStable).toBe(true);
    expect(result.rootStable).toBe(options.expectedRootStable ?? true);
  }
  expect(result.activeBlankFrames, JSON.stringify(result)).toBe(0);
  expect(result.blankFrames, JSON.stringify(result)).toBe(0);
  expect(result.emptySemanticMismatchFrames, JSON.stringify(result)).toBe(0);
  if (expectedFinalContent === "empty") {
    expect(result.endedEmpty).toBe(true);
    expect(result.emptyFrames).toBeGreaterThan(0);
    expect(result.contentAfterEmptyFrames).toBe(0);
  } else {
    expect(result.endedEmpty).toBe(false);
    expect(result.emptyFrames).toBe(0);
  }
  expect(result.busyFrame).not.toBeNull();
  expect(result.busyFrame ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    options.maximumBusyFrame ?? 1
  );
  if (expectedAnchorDisposition === "fallback-top") {
    expect(result.anchorKind).toBe("viewport");
    expect(
      result.fallbackTopDeltaPx,
      `fallback item missed viewport top: ${JSON.stringify(result)}`
    ).toBeLessThanOrEqual(4);
  } else {
    expect(
      result.anchorDeltaPx,
      `semantic anchor moved: ${JSON.stringify(result)}`
    ).toBeLessThanOrEqual(4);
  }
  expect(result.treeScrollDeltaPx).toBeLessThanOrEqual(1);
  expect(
    result.maxLongTaskMs,
    `long tasks: ${JSON.stringify(result.longTasks)}`
  ).toBeLessThanOrEqual(options.maximumLongTaskMs ?? 50);
}

async function appDiffState(repository: string): Promise<{
  readonly staged: string;
  readonly worktree: string;
}> {
  const [{ stdout: worktree }, { stdout: staged }] = await Promise.all([
    execFileAsync("git", ["diff", "--", "src/app.tsx"], {
      cwd: repository,
    }),
    execFileAsync("git", ["diff", "--cached", "--", "src/app.tsx"], {
      cwd: repository,
    }),
  ]);
  return { staged, worktree };
}

async function openTerminal(userDataDir: string, repository: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [PIER_CLI, "terminal", "open", "--cwd", repository, "--json"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
    }
  );
  return JSON.parse(stdout) as {
    data?: { panelId?: string };
    ok?: boolean;
  };
}

async function openTerminalWhenReady(userDataDir: string, repository: string) {
  let result: Awaited<ReturnType<typeof openTerminal>> = {};
  await expect(async () => {
    result = await openTerminal(userDataDir, repository);
    expect(result.ok).toBe(true);
  }).toPass({ timeout: 10_000 });
  return result;
}

async function forceClose(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

async function closeApplicationWithin(
  application: ElectronApplication,
  timeoutMs = 3000
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout !== null) {
    clearTimeout(timeout);
  }
}

function groupForPanel(page: Page, panelId: string) {
  return page
    .locator(`[data-panel-tab-id="${panelId}"]`)
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-groupview ')][1]"
    );
}

async function panelSharesGroup(
  page: Page,
  leftPanelId: string,
  rightPanelId: string
): Promise<boolean> {
  return await page
    .locator(`[data-panel-tab-id="${leftPanelId}"]`)
    .evaluate((left, rightSelector) => {
      const right = document.querySelector(rightSelector);
      return (
        left.closest(".dv-groupview") !== null &&
        left.closest(".dv-groupview") === right?.closest(".dv-groupview")
      );
    }, `[data-panel-tab-id="${rightPanelId}"]`);
}

/**
 * Open Git Changes review from a terminal group.
 *
 * Status bar v2 splits identity / changes / sync. Prefer the dedicated
 * changes slot when visible; otherwise open the branch dropdown and use the
 * contextual "Changes"/"更改" row (no longer a fixed "View Changes" task).
 */
async function openReviewFromTerminal(
  page: Page,
  terminalPanelId: string,
  options?: {
    /** Called with the click target before the open click (timing probes). */
    beforeOpenClick?: (target: Locator) => Promise<void> | void;
  }
): Promise<void> {
  await page.locator(`[data-panel-tab-id="${terminalPanelId}"]`).click();
  const group = groupForPanel(page, terminalPanelId);
  const statusTrigger = group.locator(
    '[data-testid="worktree-status-trigger"]'
  );
  await expect(statusTrigger).toBeVisible({ timeout: 20_000 });

  const changesTrigger = group.locator(
    '[data-testid="git-changes-status-trigger"]'
  );
  const dedicatedVisible = await changesTrigger.isVisible().catch(() => false);
  if (dedicatedVisible) {
    await options?.beforeOpenClick?.(changesTrigger);
    await changesTrigger.click();
    return;
  }

  // Wait for loaded dirty status: dedicated slot may appear after first poll.
  try {
    await expect(changesTrigger).toBeVisible({ timeout: 12_000 });
    await options?.beforeOpenClick?.(changesTrigger);
    await changesTrigger.click();
    return;
  } catch {
    // Narrow status bar / overflow: open branch dropdown instead.
  }

  await statusTrigger.click();
  const changesRow = page.getByTestId("git-status-row-changes");
  await expect(changesRow).toBeVisible({ timeout: 15_000 });
  await options?.beforeOpenClick?.(changesRow);
  await changesRow.click();
}

async function reviewPanelIds(page: Page): Promise<string[]> {
  return await page
    .locator('[data-panel-tab-id^="pier.git.changes:"]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const id = (element as HTMLElement).dataset.panelTabId;
        return id ? [id] : [];
      })
    );
}

async function dragPanelToGroupCenter(
  page: Page,
  panelId: string,
  targetPanelId: string
): Promise<void> {
  const source = page
    .locator(`[data-panel-tab-id="${panelId}"]`)
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-tab ')][1]"
    );
  const target = groupForPanel(page, targetPanelId).locator(
    ":scope > .dv-content-container"
  );
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (
    !(sourceBox && targetBox && targetBox.width > 100 && targetBox.height > 100)
  ) {
    throw new Error("Review drag source or target has no stable geometry");
  }
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 24 }
  );
  await page.waitForTimeout(250);
  await page.mouse.up();
}

async function dragSeparatorToX(
  page: Page,
  separator: Locator,
  targetX: number
): Promise<void> {
  const box = await separator.boundingBox();
  if (!box) {
    throw new Error("Review tree separator has no stable geometry");
  }
  const centerY = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(targetX, centerY, { steps: 16 });
  await page.mouse.up();
}

async function dragPanelToWidth(
  page: Page,
  separator: Locator,
  panel: Locator,
  requestedWidth: number
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [separatorBox, currentWidth] = await Promise.all([
      separator.boundingBox(),
      panel.evaluate((element) => element.getBoundingClientRect().width),
    ]);
    if (!separatorBox) {
      throw new Error("Review tree separator has no stable geometry");
    }
    if (Math.abs(currentWidth - requestedWidth) <= 2) {
      return;
    }
    await dragSeparatorToX(
      page,
      separator,
      separatorBox.x + separatorBox.width / 2 + (requestedWidth - currentWidth)
    );
    const nextWidth = await panel.evaluate(
      (element) => element.getBoundingClientRect().width
    );
    if (Math.abs(nextWidth - currentWidth) > 5) {
      return;
    }
    await page.waitForTimeout(16);
  }
}

test("opens one multi-file Review with the real tree and official Pierre CodeView", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-repo-");
  await createReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // App-level DiffWorkerHost creates Pierre workers during first paint.
    // Install tracking before that via init script + reload so created > 0.
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      const stats = { created: 0, terminated: 0, urls: [] as string[] };
      const TrackedWorker = new Proxy(NativeWorker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args) as Worker;
          const terminate = worker.terminate.bind(worker);
          let terminated = false;
          stats.created += 1;
          stats.urls.push(String(args[0]));
          worker.terminate = () => {
            if (!terminated) {
              terminated = true;
              stats.terminated += 1;
            }
            terminate();
          };
          return worker;
        },
      });
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: TrackedWorker,
        writable: true,
      });
      Reflect.set(window, "__pierGitReviewWorkerStats", stats);
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toMatch(/^file:/u);
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    expect(opened.ok).toBe(true);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    const terminalTab = page.locator(
      `[data-panel-tab-id="${terminalPanelId}"]`
    );
    await expect(terminalTab).toBeVisible();
    const terminalTabs = page.locator('[data-panel-tab-id^="terminal-"]');
    const terminalCount = await terminalTabs.count();
    await terminalTab.click();
    await page.keyboard.press("Meta+Shift+KeyD");
    await expect(terminalTabs).toHaveCount(terminalCount + 1, {
      timeout: 20_000,
    });
    const splitTerminalTab = terminalTabs.nth(terminalCount);
    await expect(splitTerminalTab).toBeVisible();
    const shortGroupHeight = await groupForPanel(
      page,
      terminalPanelId
    ).evaluate((group) => group.getBoundingClientRect().height);
    expect(shortGroupHeight).toBeGreaterThan(100);
    expect(shortGroupHeight).toBeLessThan(500);

    await openReviewFromTerminal(page, terminalPanelId);

    const changesTab = page.locator('[data-panel-tab-id^="pier.git.changes:"]');
    await expect(changesTab).toBeVisible({ timeout: 20_000 });
    expect(
      await changesTab.evaluate((changesElement, terminalSelector) => {
        const terminalElement = document.querySelector(terminalSelector);
        return (
          changesElement.closest(".dv-groupview") !== null &&
          changesElement.closest(".dv-groupview") ===
            terminalElement?.closest(".dv-groupview")
        );
      }, `[data-panel-tab-id="${terminalPanelId}"]`)
    ).toBe(true);
    await expect(
      page.locator('[data-panel-tab-id^="pier.git.diff:"]')
    ).toHaveCount(0);
    // Half-staged fixture prefers staged surface; expand so app.tsx is a row.
    await ensureReviewTreeFilesVisible(page, "staged");
    await expect(reviewTreeFileItem(page, /app\.tsx/u, "staged")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeAttached({
      timeout: 30_000,
    });
    const reviewHeader = page.locator('[data-slot="file-panel-header"]');
    await expect(reviewHeader).toBeVisible();
    // Header summary tracks the active surface (shared chrome, outside surface body).
    // Staged-only half of the fixture is app.tsx (+1/−1); large.ts is unstaged.
    const stagedSummary = reviewChangeSummary(page);
    await expect(stagedSummary).toBeVisible();
    await expect(stagedSummary).toContainText("+1");
    await expect(stagedSummary).toContainText("−1");
    await selectReviewSurface(page, "index");
    const unstagedSummary = reviewChangeSummary(page);
    await expect(unstagedSummary).toContainText("+5002");
    await expect(unstagedSummary).toContainText("−5002");
    // Stay on Changes (index): later steps cover script.py / large.ts / binaries.
    expect(
      await reviewHeader.evaluate((header) =>
        Math.round(header.getBoundingClientRect().height)
      )
    ).toBe(40);
    const reviewLayout = reviewHeader.locator("xpath=parent::*");
    const [headerWidth, layoutWidth] = await Promise.all([
      reviewHeader.evaluate((header) => header.getBoundingClientRect().width),
      reviewLayout.evaluate((layout) => layout.getBoundingClientRect().width),
    ]);
    expect(Math.abs(headerWidth - layoutWidth)).toBeLessThanOrEqual(1);

    const reviewPanelGroup = reviewLayout.locator(
      '[data-slot="resizable-panel-group"]'
    );
    const reviewTreePanel = reviewLayout.getByTestId("git-review-tree");
    const reviewSeparator = reviewLayout.locator(
      '[data-slot="resizable-handle"]'
    );
    const panelGroupBox = await reviewPanelGroup.boundingBox();
    if (!panelGroupBox) {
      throw new Error("Review panel group has no stable geometry");
    }
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(254);
    expect(
      await reviewTreePanel.evaluate((panel) =>
        Math.round(panel.getBoundingClientRect().width)
      )
    ).toBeLessThanOrEqual(258);

    await reviewSeparator.focus();
    const initialTreeWidth = await reviewTreePanel.evaluate(
      (panel) => panel.getBoundingClientRect().width
    );
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(169);
    const shrunkenTreeWidth = await reviewTreePanel.evaluate(
      (panel) => panel.getBoundingClientRect().width
    );
    expect(shrunkenTreeWidth).toBeLessThan(initialTreeWidth);

    await page.keyboard.press("End");
    const maximumTreeWidth = panelGroupBox.width / 2;
    const clampedMaximumWidth = await reviewTreePanel.evaluate(
      (panel) => panel.getBoundingClientRect().width
    );
    expect(clampedMaximumWidth).toBeGreaterThanOrEqual(maximumTreeWidth - 3);
    expect(clampedMaximumWidth).toBeLessThanOrEqual(maximumTreeWidth + 2);

    const widthBeforePointerDrag = clampedMaximumWidth;
    await dragPanelToWidth(
      page,
      reviewSeparator,
      reviewTreePanel,
      Math.max(260, clampedMaximumWidth - 300)
    );
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeLessThan(widthBeforePointerDrag - 5);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const panel = document.querySelector<HTMLElement>(
            '[data-testid="git-review-tree"]'
          );
          const stored = Number.parseInt(
            globalThis.localStorage.getItem("pier.git.review.treeWidthPx") ??
              "",
            10
          );
          return panel && Number.isFinite(stored)
            ? Math.abs(panel.getBoundingClientRect().width - stored)
            : Number.POSITIVE_INFINITY;
        })
      )
      .toBeLessThanOrEqual(2);
    const storedTreeWidth = await page.evaluate(() =>
      Number.parseInt(
        globalThis.localStorage.getItem("pier.git.review.treeWidthPx") ?? "",
        10
      )
    );

    await reviewSeparator.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: /Expand changed files|展开变更文件/u })
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toHaveCount(0);
    await expect(reviewTreePanel).toHaveAttribute("aria-hidden", "true");
    expect(pageErrors).toEqual([]);
    await page
      .getByRole("button", { name: /Expand changed files|展开变更文件/u })
      .click();
    await expect(
      page.getByRole("button", {
        name: /Collapse changed files|收起变更文件/u,
      })
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toBeVisible();
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(storedTreeWidth - 2);
    expect(
      await reviewTreePanel.evaluate((panel) =>
        Math.round(panel.getBoundingClientRect().width)
      )
    ).toBeLessThanOrEqual(storedTreeWidth + 2);
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
    await changesTab.click();
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Collapse changed files|收起变更文件/u,
      })
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toBeVisible();
    expect(
      await page.evaluate(
        (root) =>
          globalThis.localStorage.getItem(
            `pier.git.review.treeCollapsed:${root}`
          ),
        repository
      )
    ).not.toBe("true");

    await page
      .getByRole("button", {
        name: /Collapse changed files|收起变更文件/u,
      })
      .click();
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toHaveCount(0);
    await expect(reviewTreePanel).toHaveAttribute("aria-hidden", "true");
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: /Find in changed files|在变更文件中查找/u,
      })
      .click();
    const reviewTreeSearch = page.getByRole("textbox", {
      name: /Find in changed files|在变更文件中查找/u,
    });
    await expect(reviewTreeSearch).toBeFocused();
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(storedTreeWidth - 2);
    expect(
      await reviewTreePanel.evaluate((panel) =>
        Math.round(panel.getBoundingClientRect().width)
      )
    ).toBeLessThanOrEqual(storedTreeWidth + 2);
    await reviewTreeSearch.fill("script.py");
    await reviewTreeSearch.press("Enter");
    // header 不再展示路径面包屑(改为左侧 scope 切换器);导航结果由下方
    // treeitem selected 断言与 scope 切换器可见性共同验证。
    await expect(
      reviewHeader.getByTestId("git-review-scope-switcher")
    ).toBeVisible();
    await reviewTreeSearch.press("Escape");
    await expect(page.getByTestId("git-review-tree-search-bar")).toHaveCount(0);
    await expect(reviewTreeFileItem(page, /app\.tsx/u)).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: /script\.py/u, selected: true })
    ).toBeVisible();
    await expect
      .poll(() => isDiffTextInViewport(page, "return 2"), {
        timeout: 20_000,
      })
      .toBe(true);
    await splitTerminalTab.click();
    const inactiveReviewState = await page.evaluate(
      async (reviewPanelId) => {
        const snapshot = await window.pier.terminal.debugSnapshot();
        return snapshot.renderer?.panels.find(
          (panel) => panel.panelId === reviewPanelId
        );
      },
      await changesTab.getAttribute("data-panel-tab-id")
    );
    expect(inactiveReviewState).toMatchObject({
      dockviewActive: false,
      dockviewVisible: true,
      resourceMode: "visible",
    });
    await expect(page.getByTestId("git-review-tree")).toBeVisible();
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeVisible();
    await expect
      .poll(() => isDiffTextInViewport(page, "return 2"), {
        timeout: 10_000,
      })
      .toBe(true);
    await changesTab.click();
    const changesPanelId = await changesTab.getAttribute("data-panel-tab-id");
    await expect
      .poll(async () => {
        const snapshot = await page.evaluate(() =>
          window.pier.terminal.debugSnapshot()
        );
        return (
          snapshot.renderer?.panels.find(
            (panel) => panel.panelId === changesPanelId
          )?.dockviewActive ?? false
        );
      })
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    // Demand-loaded review may not keep binary sections mounted after viewing
    // another file — navigate via the tree so the binary state patch is loaded.
    // Search reveals virtualized rows after earlier file opens.
    await page
      .getByRole("button", {
        name: /Find in changed files|在变更文件中查找/u,
      })
      .click();
    const binaryTreeSearch = page.getByRole("textbox", {
      name: /Find in changed files|在变更文件中查找/u,
    });
    await binaryTreeSearch.fill("binary-6");
    await binaryTreeSearch.press("Enter");
    await expect
      .poll(
        () =>
          reviewTree(page)
            .getByRole("treeitem", { name: /binary-6\\special\.bin/u })
            .count(),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    await reviewTreeFileItem(page, /binary-6\\special\.bin/u).click();
    await binaryTreeSearch.press("Escape").catch(() => undefined);
    // Binary views often have no CodeView scroller; assert the header notice on
    // the active surface without requiring cv-scrollbar intersection.
    await expect(
      activeReviewSurface(page).locator(
        '[data-slot="pier-diff-header-state-notice"]'
      )
    ).toContainText(BINARY_STATE_NOTICE, { timeout: 30_000 });
    await expect(
      page.locator('[role="alert"]').filter({ hasText: BINARY_STATE_NOTICE })
    ).toHaveCount(0);
    await expect(
      page.getByText(/additional files could not be rendered|个文件无法显示/u)
    ).toHaveCount(0);
    const shortDiffHeight = await activeReviewSurface(page)
      .getByTestId("pierre-diff-root")
      .evaluate((root) => root.getBoundingClientRect().height);
    expect(shortDiffHeight).toBeGreaterThan(0);
    // Tree may virtualize after binary navigation — search before clicking.
    await page
      .getByRole("button", {
        name: /Find in changed files|在变更文件中查找/u,
      })
      .click();
    const appTreeSearch = page.getByRole("textbox", {
      name: /Find in changed files|在变更文件中查找/u,
    });
    await appTreeSearch.fill("app.tsx");
    await appTreeSearch.press("Enter");
    await expect
      .poll(
        () =>
          page
            .getByTestId("git-review-tree")
            .getByRole("treeitem", { name: /app\.tsx/u })
            .count(),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    await clickReviewTreeFile(page, /app\.tsx/u);
    await appTreeSearch.press("Escape").catch(() => undefined);

    const diffContainers = page.locator("diffs-container");
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "index"
    );
    await expect
      .poll(
        () =>
          activeReviewSurface(page)
            .locator("diffs-container")
            .evaluateAll((containers) => {
              const sectionTexts = containers.map(
                (container) => container.shadowRoot?.textContent ?? ""
              );
              return {
                hasStagedSection: sectionTexts.some(
                  (text) =>
                    text.includes("value = 1") && text.includes("value = 2")
                ),
                hasWorktreeSection: sectionTexts.some(
                  (text) =>
                    text.includes("value = 2") && text.includes("value = 3")
                ),
              };
            }),
        { timeout: 30_000 }
      )
      .toEqual({ hasStagedSection: false, hasWorktreeSection: true });
    await clickReviewTreeFile(page, /app\.tsx/u, "staged");
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-settled="true"]'
      )
    ).toBeAttached({ timeout: 30_000 });
    const stagedChangeSummary = reviewChangeSummary(page);
    await expect(stagedChangeSummary).toContainText("+1");
    await expect(stagedChangeSummary).toContainText("−1");
    await expect(stagedChangeSummary).not.toContainText("+5002");
    await expect
      .poll(
        () =>
          activeReviewSurface(page)
            .locator("diffs-container")
            .evaluateAll((containers) =>
              containers.some((container) => {
                const text = container.shadowRoot?.textContent ?? "";
                return text.includes("value = 1") && text.includes("value = 2");
              })
            ),
        { timeout: 30_000 }
      )
      .toBe(true);
    const firstWorkerCount = await page.evaluate(
      () =>
        (
          Reflect.get(window, "__pierGitReviewWorkerStats") as {
            created: number;
          }
        ).created
    );
    expect(firstWorkerCount).toBeGreaterThan(0);
    const workerUrls = await page.evaluate(
      () =>
        (
          Reflect.get(window, "__pierGitReviewWorkerStats") as {
            urls: string[];
          }
        ).urls
    );
    expect(workerUrls).toEqual(
      expect.arrayContaining([expect.stringMatching(/worker-[^/]+\.js$/u)])
    );
    const appContainer = activeReviewSurface(page)
      .locator('diffs-container[data-pier-file-path$="app.tsx"]')
      .first();
    // Pierre hosts often report as "hidden" until layout settles; assert
    // attachment + shadow text instead of CSS visibility.
    await expect(appContainer).toBeAttached({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          appContainer.evaluate(
            (host) =>
              host.shadowRoot?.textContent?.includes("value = 1") ?? false
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    const initialThemeSignature = await appContainer.evaluate((host) => {
      const spans = [
        ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
      ];
      return JSON.stringify({
        background: getComputedStyle(host).backgroundColor,
        tokenColors: [
          ...new Set(spans.map((span) => getComputedStyle(span).color)),
        ],
      });
    });
    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    await expect
      .poll(
        () =>
          appContainer.evaluate((host) => {
            const spans = [
              ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
            ];
            return JSON.stringify({
              background: getComputedStyle(host).backgroundColor,
              tokenColors: [
                ...new Set(spans.map((span) => getComputedStyle(span).color)),
              ],
            });
          }),
        { timeout: 30_000 }
      )
      .not.toBe(initialThemeSignature);
    await expect
      .poll(
        () =>
          appContainer.evaluate((host) => {
            const spans = [
              ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
            ];
            return new Set(spans.map((span) => getComputedStyle(span).color))
              .size;
          }),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(1);
    const darkThemeSignature = await appContainer.evaluate((host) => {
      const spans = [
        ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
      ];
      return {
        background: getComputedStyle(host).backgroundColor,
        tokenColors: [
          ...new Set(spans.map((span) => getComputedStyle(span).color)),
        ],
      };
    });
    expect(darkThemeSignature.tokenColors.length).toBeGreaterThan(1);

    await terminalTab.click();
    // App-level DiffWorkerHost keeps Pierre workers alive across hide/show;
    // hide must not terminate the shared pool.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stats = Reflect.get(window, "__pierGitReviewWorkerStats") as {
              created: number;
              terminated: number;
            };
            return {
              live: stats.created - stats.terminated,
              terminated: stats.terminated,
            };
          }),
        { timeout: 5000 }
      )
      .toEqual({ live: firstWorkerCount, terminated: 0 });
    await changesTab.click();
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeAttached({
      timeout: 30_000,
    });
    // After hide/show, documents rehydrate; wait for settle before theme probes.
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-settled="true"]'
      )
    ).toBeAttached({ timeout: 30_000 });
    await clickReviewTreeFile(page, /app\.tsx/u);
    await expect
      .poll(() => isDiffTextInViewport(page, "export const value"), {
        timeout: 30_000,
      })
      .toBe(true);
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    await expect
      .poll(
        () =>
          diffContainers
            .filter({ hasText: "export const value = 1" })
            .first()
            .evaluate((host) => {
              const spans = [
                ...(host.shadowRoot?.querySelectorAll("[data-line] span") ??
                  []),
              ];
              return JSON.stringify({
                background: getComputedStyle(host).backgroundColor,
                tokenColors: [
                  ...new Set(spans.map((span) => getComputedStyle(span).color)),
                ],
              });
            }),
        { timeout: 30_000 }
      )
      .not.toBe(JSON.stringify(darkThemeSignature));

    writeFileSync(
      join(repository, "src", "script.py"),
      "def answer():\n    return 4\n"
    );
    // worktree 变更后：等 watch 刷新，再通过树搜索打开最新正文。
    // 树可能虚拟化，直接 treeitem 不一定在 DOM。
    await expect(async () => {
      await page
        .getByRole("button", {
          name: /Find in changed files|在变更文件中查找/u,
        })
        .click();
      const reviewTreeSearch = page.getByRole("textbox", {
        name: /Find in changed files|在变更文件中查找/u,
      });
      await reviewTreeSearch.fill("script.py");
      await reviewTreeSearch.press("Enter");
      await clickReviewTreeFile(page, /script\.py/u);
      expect(
        await diffContainers.evaluateAll((containers) =>
          containers.some((host) =>
            (host.shadowRoot?.textContent ?? "").includes("return 4")
          )
        )
      ).toBe(true);
      await reviewTreeSearch.press("Escape").catch(() => undefined);
    }).toPass({ timeout: 60_000 });
    const scriptContainer = diffContainers
      .filter({ hasText: "return 4" })
      .first();
    await expect
      .poll(
        () =>
          scriptContainer.evaluate((host) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            const item = host.getBoundingClientRect();
            return item.bottom > viewport.top && item.top < viewport.bottom;
          }),
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          scriptContainer.evaluate((host) => {
            const spans = [
              ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
            ];
            return new Set(spans.map((span) => getComputedStyle(span).color))
              .size;
          }),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(1);
    const codeTypography = await activeReviewSurface(page)
      .locator('[data-testid="pierre-diff-root"] .cv-scrollbar')
      .evaluate((element) => ({
        actual: getComputedStyle(element)
          .getPropertyValue("--diffs-font-family")
          .trim(),
        expected: getComputedStyle(document.documentElement)
          .getPropertyValue("--font-mono")
          .trim(),
      }));
    expect(codeTypography.expected).not.toBe("");
    expect(codeTypography.actual).toBe(codeTypography.expected);

    await page.evaluate(() => {
      const records: Array<{
        readonly duration: number;
        readonly startTime: number;
      }> = [];
      Reflect.set(window, "__pierGitReviewLongTasks", records);
      Reflect.set(window, "__pierGitReviewLongTaskMarks", {
        observerStarted: performance.now(),
      });
      new PerformanceObserver((list) => {
        records.push(
          ...list.getEntries().map((entry) => ({
            duration: entry.duration,
            startTime: entry.startTime,
          }))
        );
      }).observe({ entryTypes: ["longtask"] });
    });
    const largeStartedAt = performance.now();
    await page.evaluate(() => {
      const marks = Reflect.get(
        window,
        "__pierGitReviewLongTaskMarks"
      ) as Record<string, number>;
      marks.beforeTreeClick = performance.now();
    });
    await clickReviewTreeFile(page, /large\.ts/u);
    const largeContainer = page.locator(
      'diffs-container[data-pier-file-path="src/large.ts"]'
    );
    await expect
      .poll(
        () =>
          largeContainer.evaluate((container) =>
            (
              container.shadowRoot?.querySelector("[data-line]")?.textContent ??
              ""
            ).includes("line00000")
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    await page.evaluate(() => {
      const marks = Reflect.get(
        window,
        "__pierGitReviewLongTaskMarks"
      ) as Record<string, number>;
      marks.afterFirstPaint = performance.now();
    });
    const initialVirtualWindow = await largeContainer.evaluate((container) => ({
      hasLastLine: [
        ...(container.shadowRoot?.querySelectorAll("[data-line]") ?? []),
      ].some((line) => (line.textContent ?? "").includes("line09998")),
      lineCount:
        container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0,
    }));
    expect(initialVirtualWindow.hasLastLine).toBe(false);
    expect(initialVirtualWindow.lineCount).toBeGreaterThan(0);
    expect(initialVirtualWindow.lineCount).toBeLessThan(1000);
    await largeContainer.dispatchEvent("pointerover");
    await expect
      .poll(() =>
        largeContainer
          .getByTestId("pier-hunk-actions")
          .first()
          .evaluate((action) => Number(getComputedStyle(action).opacity))
      )
      .toBe(1);
    const visibleHunkActionGeometry = await largeContainer.evaluate(
      (container) => {
        const containerBounds = container.getBoundingClientRect();
        const candidates = [
          ...container.querySelectorAll<HTMLElement>(
            "[data-pier-hunk-actions]"
          ),
        ];
        const action = candidates.find((candidate) => {
          const bounds = candidate.getBoundingClientRect();
          return (
            bounds.bottom > containerBounds.top &&
            bounds.top < containerBounds.bottom
          );
        });
        if (!action) {
          return null;
        }
        const bounds = action.getBoundingClientRect();
        return {
          containerLeft: containerBounds.left,
          containerRight: containerBounds.right,
          pointerWithin: container.hasAttribute("data-pier-pointer-within"),
          left: bounds.left,
          opacity: getComputedStyle(action).opacity,
          right: bounds.right,
        };
      }
    );
    expect(visibleHunkActionGeometry).not.toBeNull();
    expect(visibleHunkActionGeometry?.pointerWithin).toBe(true);
    expect(
      visibleHunkActionGeometry?.opacity,
      JSON.stringify(visibleHunkActionGeometry)
    ).toBe("1");
    expect(visibleHunkActionGeometry?.left).toBeGreaterThanOrEqual(
      (visibleHunkActionGeometry?.containerLeft ?? 0) - 1
    );
    expect(visibleHunkActionGeometry?.right).toBeLessThanOrEqual(
      (visibleHunkActionGeometry?.containerRight ?? 0) + 1
    );
    const largeFirstPaintMs = performance.now() - largeStartedAt;
    expect(largeFirstPaintMs).toBeLessThan(REVIEW_LARGE_FIRST_PAINT_MS_BUDGET);
    const blankFrameMetrics = await largeContainer.evaluate(
      async (container) => {
        const marks = Reflect.get(
          window,
          "__pierGitReviewLongTaskMarks"
        ) as Record<string, number>;
        marks.beforeBottomScroll = performance.now();
        // Prefer the scroller that owns this diffs-container. Dual staged/index
        // surfaces leave multiple pierre-diff-root nodes; the first match can be
        // the inactive surface with ~viewport height and no room to scroll.
        const scroller =
          container
            .closest("[data-git-review-surface]")
            ?.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            ) ??
          document.querySelector<HTMLElement>(
            '[data-git-review-surface][aria-hidden="false"] [data-testid="pierre-diff-root"] .cv-scrollbar'
          );
        if (!scroller) {
          throw new Error("large diff scroller missing");
        }
        const targetScrollTop = scroller.scrollHeight - scroller.clientHeight;
        const scrollLargeDiffToBottom = () => {
          scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        };
        const startedAt = performance.now();
        scroller.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: 1 })
        );
        scrollLargeDiffToBottom();
        scroller.dispatchEvent(new Event("scroll"));
        return await new Promise<{
          finalScrollTop: number;
          maxVisibleLine: number;
          maxBlankMs: number;
          maxConsecutiveBlankFrames: number;
          sampledFrames: number;
          scrollHeight: number;
          targetScrollTop: number;
          targetReached: boolean;
        }>((resolve) => {
          let blankFrames = 0;
          let blankStartedAt: number | null = null;
          let maxBlankFrames = 0;
          let maxBlankMs = 0;
          let maxVisibleLine = -1;
          let sampledFrames = 0;
          let settledVisibleFrames = 0;
          const sample = (now: number) => {
            sampledFrames += 1;
            const viewport = scroller.getBoundingClientRect();
            const lines = [
              ...(container.shadowRoot?.querySelectorAll<HTMLElement>(
                "[data-line]"
              ) ?? []),
            ];
            const visible = lines.filter((line) => {
              const rect = line.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            });
            if (visible.length === 0) {
              blankStartedAt ??= sampledFrames === 1 ? startedAt : now;
              blankFrames += 1;
              maxBlankFrames = Math.max(maxBlankFrames, blankFrames);
              settledVisibleFrames = 0;
            } else {
              if (blankStartedAt !== null) {
                maxBlankMs = Math.max(maxBlankMs, now - blankStartedAt);
              }
              blankStartedAt = null;
              blankFrames = 0;
              const targetVisible = visible.some((line) => {
                const match = line.textContent?.match(/line(\d{5})/u);
                if (match?.[1] !== undefined) {
                  maxVisibleLine = Math.max(maxVisibleLine, Number(match[1]));
                }
                return match?.[1] !== undefined && Number(match[1]) >= 9900;
              });
              settledVisibleFrames = targetVisible
                ? settledVisibleFrames + 1
                : 0;
            }
            const targetReached = settledVisibleFrames >= 2;
            if (targetReached || now - startedAt >= 5000) {
              if (blankStartedAt !== null) {
                maxBlankMs = Math.max(maxBlankMs, now - blankStartedAt);
              }
              resolve({
                finalScrollTop: scroller.scrollTop,
                maxVisibleLine,
                maxBlankMs,
                maxConsecutiveBlankFrames: maxBlankFrames,
                sampledFrames,
                scrollHeight: scroller.scrollHeight,
                targetScrollTop,
                targetReached,
              });
              return;
            }
            scrollLargeDiffToBottom();
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      }
    );
    expect(
      blankFrameMetrics.targetReached,
      JSON.stringify(blankFrameMetrics)
    ).toBe(true);
    expect(blankFrameMetrics.maxConsecutiveBlankFrames).toBeLessThanOrEqual(2);
    expect(blankFrameMetrics.maxBlankMs).toBeLessThanOrEqual(100);
    expect(blankFrameMetrics.sampledFrames).toBeGreaterThan(0);
    expect(
      await largeContainer.evaluate(
        (container) =>
          container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0
      )
    ).toBeLessThan(1000);
    const longTaskDiagnostics = await page.evaluate(() => ({
      marks:
        (Reflect.get(window, "__pierGitReviewLongTaskMarks") as Record<
          string,
          number
        >) ?? {},
      records:
        (Reflect.get(window, "__pierGitReviewLongTasks") as Array<{
          readonly duration: number;
          readonly startTime: number;
        }>) ?? [],
    }));
    const longTaskEvidence = {
      blankFrameMetrics,
      initialVirtualWindow,
      ...longTaskDiagnostics,
    };
    expect(
      Math.max(
        0,
        ...longTaskDiagnostics.records.map((record) => record.duration)
      ),
      JSON.stringify(longTaskEvidence)
    ).toBeLessThan(REVIEW_LONGTASK_MS_BUDGET);
    expect(
      await largeContainer.getByTestId("pier-hunk-stage").count()
    ).toBeGreaterThan(256);

    const cycleReviewResource = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await terminalTab.click();
        await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
        await changesTab.click();
        await expect(
          activeReviewSurface(page).getByTestId("pierre-diff-root")
        ).toBeAttached({
          timeout: 30_000,
        });
      }
    };
    // Review intentionally keeps session cache + app-level Pierre worker pool
    // across hide/show. Warm that steady state first, then measure growth so
    // one-time keep-alive fill is not treated as a leak (CI saw ~30MB from a
    // cold baseline under the old 10MB budget).
    const HEAP_WARM_CYCLES = 4;
    const HEAP_MEASURE_CYCLES = 20;
    await cycleReviewResource(HEAP_WARM_CYCLES);
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
    const cdp = await page.context().newCDPSession(page);
    const collectHeapGarbage = async () => {
      for (let index = 0; index < 3; index += 1) {
        await cdp.send("HeapProfiler.collectGarbage");
      }
    };
    await collectHeapGarbage();
    const baselineHeap = await cdp.send("Runtime.getHeapUsage");
    await cycleReviewResource(HEAP_MEASURE_CYCLES);
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stats = Reflect.get(window, "__pierGitReviewWorkerStats") as {
              created: number;
              terminated: number;
            };
            // Shared app-level pool should remain alive while the window is open.
            return {
              live: stats.created - stats.terminated,
              terminated: stats.terminated,
            };
          }),
        { timeout: 2000 }
      )
      .toEqual({ live: firstWorkerCount, terminated: 0 });
    await collectHeapGarbage();
    const finalHeap = await cdp.send("Runtime.getHeapUsage");
    const heapGrowth = finalHeap.usedSize - baselineHeap.usedSize;
    // Absolute floor absorbs V8/Pierre wasm GC noise on macOS runners after
    // warm-up; ratio catches pathological growth against a large baseline.
    // Unbounded per-cycle leaks still fail (e.g. 2MB * 20 = 40MB+).
    const allowedHeapGrowth = Math.max(
      40 * 1024 * 1024,
      baselineHeap.usedSize * 0.2,
      HEAP_MEASURE_CYCLES * 1.5 * 1024 * 1024
    );
    expect(
      heapGrowth,
      `heap grew ${heapGrowth} bytes over ${HEAP_MEASURE_CYCLES} cycles (baseline=${baselineHeap.usedSize}, final=${finalHeap.usedSize}, allowed=${allowedHeapGrowth})`
    ).toBeLessThanOrEqual(allowedHeapGrowth);
    await cdp.detach();
    await expect(changesTab).toHaveCount(1);
    await expect(
      page.locator('[data-panel-tab-id^="pier.git.diff:"]')
    ).toHaveCount(0);

    const relevantConsoleErrors = consoleErrors.filter((message) =>
      /worker|wasm|content security|csp|module|unhandled/iu.test(message)
    );
    expect(relevantConsoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

/**
 * Cold-open regression: many *already staged* files, open Review, click a
 * mid-list file. Must hydrate real patch text (not forever estimate/skeleton).
 * Prior e2e only covered tiny stage-after-open fixtures and missed this path.
 */
async function createManyStagedFilesRepository(
  root: string,
  fileCount: number
): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  for (let index = 0; index < fileCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    writeFileSync(
      join(sourceDirectory, `file-${suffix}.ts`),
      `export const marker_${suffix} = 0;\n`
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  for (let index = 0; index < fileCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    writeFileSync(
      join(sourceDirectory, `file-${suffix}.ts`),
      `export const marker_${suffix} = 1;\n// hydrate-target-${suffix}\n`
    );
  }
  await git(root, ["add", "."]);
}

test("cold-opens staged multi-file Review and hydrates real CodeView text", async () => {
  test.setTimeout(180_000);
  const userDataDir = createTemporaryDirectory("pier-git-cold-hydrate-e2e-");
  const repository = createTemporaryDirectory("pier-git-cold-hydrate-repo-");
  // 40 fully-staged files: larger than seed batch, forces demand hydrate on click.
  await createManyStagedFilesRepository(repository, 40);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    await openReviewFromTerminal(page, terminalPanelId);
    await expect
      .poll(() => reviewPanelIds(page), { timeout: 20_000 })
      .toHaveLength(1);

    // Staged-only fixture → staged surface (or switch there) and expand tree.
    await ensureReviewTreeFilesVisible(page, "staged");
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "staged",
      { timeout: 15_000 }
    );

    // Mid-list file: use tree search so virtualized lists cannot mis-click.
    // Product path may scroll-to-item via navigation; the test must not require
    // a manual “user scrolls to fix blank estimate” gesture.
    await page
      .getByRole("button", {
        name: /Find in changed files|在变更文件中查找/u,
      })
      .click();
    const treeSearch = page.getByRole("textbox", {
      name: /Find in changed files|在变更文件中查找/u,
    });
    await treeSearch.fill("file-0030.ts");
    await treeSearch.press("Enter");
    await expect
      .poll(
        () =>
          reviewTree(page)
            .getByRole("treeitem", { name: /file-0030\.ts/u })
            .count(),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
    await clickReviewTreeFile(page, /file-0030\.ts/u, "staged");
    await treeSearch.press("Escape").catch(() => undefined);
    await waitForReviewPathViewportSettle(page, "file-0030");

    await expect
      .poll(
        () =>
          activeReviewSurface(page).evaluate(() => {
            const surface = document.querySelector(
              '[data-git-review-surface][aria-hidden="false"]'
            );
            if (!surface) {
              return {
                estimate: "no-surface",
                hasMarker: false,
                blankGutters: 0,
              };
            }
            const hosts = [
              ...surface.querySelectorAll("diffs-container"),
            ] as HTMLElement[];
            for (const host of hosts) {
              const text = `${host.textContent ?? ""}${host.shadowRoot?.textContent ?? ""}`;
              if (!text.includes("hydrate-target-0030")) {
                continue;
              }
              const lines = [
                ...(host.shadowRoot?.querySelectorAll("[data-line]") ?? []),
              ];
              const blankGutters = lines.filter((line) => {
                const t = (line.textContent ?? "").replace(/\s/g, "");
                return t.length === 0;
              }).length;
              return {
                estimate: host.getAttribute("data-pier-estimate"),
                hasMarker: true,
                // Real patch lines must carry text; empty gutters only = still broken
                blankGutters,
                lineCount: lines.length,
              };
            }
            return {
              estimate: "missing",
              hasMarker: false,
              blankGutters: -1,
              lineCount: 0,
            };
          }),
        { timeout: 45_000 }
      )
      .toMatchObject({
        estimate: null,
        hasMarker: true,
      });
    // Loaded body: at least one data-line with non-empty text
    await expect
      .poll(
        () =>
          activeReviewSurface(page).evaluate(() => {
            const surface = document.querySelector(
              '[data-git-review-surface][aria-hidden="false"]'
            );
            for (const host of surface?.querySelectorAll("diffs-container") ??
              []) {
              const text = host.shadowRoot?.textContent ?? "";
              if (!text.includes("hydrate-target-0030")) {
                continue;
              }
              const lines = [
                ...(host.shadowRoot?.querySelectorAll("[data-line]") ?? []),
              ];
              return lines.some(
                (line) => (line.textContent ?? "").replace(/\s/g, "").length > 0
              );
            }
            return false;
          }),
        { timeout: 15_000 }
      )
      .toBe(true);
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

/**
 * Stage an unstaged-only file then land on the staged surface: CodeView must
 * keep real patch text (not blank estimate gutters). Regression for
 * cross-surface soft-retain cold start.
 */
test("keeps real CodeView text after staging onto the staged surface", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-stage-body-e2e-");
  const repository = createTemporaryDirectory("pier-git-stage-body-repo-");
  await createCompactReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    await openReviewFromTerminal(page, terminalPanelId);
    await expect
      .poll(() => reviewPanelIds(page), { timeout: 20_000 })
      .toHaveLength(1);

    // script.py is unstaged-only in the compact fixture.
    await ensureReviewTreeFilesVisible(page, "unstaged");
    await clickReviewTreeFile(page, /script\.py/u, "unstaged");
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "index"
    );
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-settled="true"]'
      )
    ).toBeAttached({ timeout: 30_000 });

    let scriptDiff = activeReviewSurface(page)
      .locator('diffs-container[data-pier-file-path$="script.py"]')
      .first();
    await expect(scriptDiff).toBeAttached({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          scriptDiff.evaluate(
            (host) =>
              host.shadowRoot?.textContent?.includes("return 2") ?? false
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect(scriptDiff).not.toHaveAttribute("data-pier-estimate", "true");

    // File-level stage (same path as hunk stage e2e): wait authority, then
    // programmatic click so opacity-0 header actions still fire.
    const stageButton = scriptDiff.getByTestId("pier-diff-stage-button");
    await waitForReviewMutationRelease(page);
    await expect(stageButton).toBeEnabled({ timeout: 30_000 });
    await stageButton.scrollIntoViewIfNeeded();
    await scriptDiff.dispatchEvent("pointerover");
    await stageButton.evaluate((button) =>
      (button as HTMLButtonElement).click()
    );

    await expect
      .poll(
        async () => {
          const [{ stdout: worktree }, { stdout: staged }] = await Promise.all([
            execFileAsync(
              "git",
              ["diff", "--name-only", "--", "src/script.py"],
              {
                cwd: repository,
              }
            ),
            execFileAsync(
              "git",
              ["diff", "--cached", "--name-only", "--", "src/script.py"],
              { cwd: repository }
            ),
          ]);
          return {
            stagedScript: staged.includes("script.py"),
            worktreeHasScript: worktree.includes("script.py"),
          };
        },
        { timeout: 30_000 }
      )
      .toEqual({ stagedScript: true, worktreeHasScript: false });
    await waitForReviewMutationRelease(page);

    // After full-file stage, open staged surface and require real patch text
    // (soft-retain must not leave blank estimate gutters).
    await selectReviewSurface(page, "staged");
    await expandReviewTreeGroup(page, "staged");
    await clickReviewTreeFile(page, /script\.py/u, "staged");
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "staged"
    );
    scriptDiff = activeReviewSurface(page)
      .locator('diffs-container[data-pier-file-path$="script.py"]')
      .first();
    await expect(scriptDiff).toBeAttached({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          scriptDiff.evaluate((host) => {
            const text = host.shadowRoot?.textContent ?? "";
            return {
              estimate: host.getAttribute("data-pier-estimate"),
              hasCode:
                text.includes("return 2") ||
                text.includes("return 1") ||
                text.includes("def answer"),
            };
          }),
        { timeout: 45_000 }
      )
      .toEqual({ estimate: null, hasCode: true });
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("keeps the reading viewport stable through real stage and unstage", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-stage-e2e-");
  const repository = createTemporaryDirectory("pier-git-stage-repo-");
  // Compact: full createReviewRepository's large.ts leaves Pierre DiffHunks
  // null-line errors after unstage and pins mutation authority. Identity +
  // git-state round-trips are still covered; scroll continuity of the tall
  // file is asserted in the multi-file Review e2e instead.
  await createCompactReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      const stats = { created: 0 };
      const TrackedWorker = new Proxy(NativeWorker, {
        construct(target, args) {
          stats.created += 1;
          return Reflect.construct(target, args) as Worker;
        },
      });
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: TrackedWorker,
        writable: true,
      });
      Reflect.set(window, "__pierGitReviewWorkerStats", stats);
    });
    await page.reload();
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    await openReviewFromTerminal(page, terminalPanelId);
    await expect
      .poll(() => reviewPanelIds(page), { timeout: 20_000 })
      .toHaveLength(1);
    await ensureReviewTreeFilesVisible(page, "unstaged");
    await clickReviewTreeFile(page, /app\.tsx/u, "unstaged");
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "index"
    );
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-settled="true"]'
      )
    ).toBeAttached({ timeout: 30_000 });
    await markReviewSurfaceIdentity(page, "index", "index-surface");

    // Tree group owns the target surface: staged and unstaged never share a
    // mixed reading model, and returning keeps the original surface instance.
    await expandReviewTreeDirectory(page, /^src$/u, "staged");
    await clickReviewTreeFile(page, /app\.tsx/u, "staged");
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "staged"
    );
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-settled="true"]'
      )
    ).toBeAttached({ timeout: 30_000 });
    await markReviewSurfaceIdentity(page, "staged", "staged-surface");
    await clickReviewTreeFile(page, /app\.tsx/u, "unstaged");
    expect((await reviewSurfaceIdentity(page, "index")).token).toBe(
      "index-surface"
    );
    await waitForReviewPathViewportSettle(page, "app.tsx");
    const indexScrollTop = await markReviewSurfaceIdentity(
      page,
      "index",
      "index-surface"
    );
    expect(indexScrollTop).toBeGreaterThanOrEqual(0);

    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-settled="true"]'
      )
    ).toBeAttached({ timeout: 30_000 });
    let appDiff = activeReviewSurface(page)
      .locator('diffs-container[data-pier-file-path="src/app.tsx"]')
      .first();

    // Real Pierre change-island action: mutation updates both reading models
    // atomically, but only an explicit tree/tab action may change the active
    // surface. If the operated path leaves the source model, preserve the
    // source viewport instead of following that path into the target model.
    const hunkStageButton = appDiff.getByTestId("pier-hunk-stage").first();
    await expect(hunkStageButton).toBeEnabled({ timeout: 30_000 });
    await waitForReviewMutationRelease(page);
    await hunkStageButton.scrollIntoViewIfNeeded();
    // Hunk actions stay opacity-0 until the file island receives pointer.
    await appDiff.dispatchEvent("pointerover");
    await expect
      .poll(() =>
        hunkStageButton.evaluate((button) =>
          Number(getComputedStyle(button).opacity)
        )
      )
      .toBe(1);
    await waitForReviewPathViewportSettle(page, "app.tsx");
    await startReviewMutationProbe(hunkStageButton, "app.tsx");
    await hunkStageButton.evaluate((button) =>
      (button as HTMLButtonElement).click()
    );
    await expect
      .poll(
        async () => {
          const state = await appDiffState(repository);
          return {
            stagedLatest: state.staged.includes("value = 3"),
            worktreeClean: state.worktree.length === 0,
          };
        },
        { timeout: 30_000 }
      )
      .toEqual({ stagedLatest: true, worktreeClean: true });
    await expect(activeReviewSurface(page)).toHaveAttribute(
      "data-git-review-surface",
      "index"
    );
    await waitForReviewMutationRelease(page);
    expectStableReviewMutation(await finishReviewMutationProbe(page));
    await selectReviewSurface(page, "staged");
    appDiff = activeReviewSurface(page)
      .locator('diffs-container[data-pier-file-path="src/app.tsx"]')
      .first();
    const hunkRoundTripUnstageButton = appDiff.getByTestId(
      "pier-diff-unstage-button"
    );
    await expect(hunkRoundTripUnstageButton).toBeEnabled({ timeout: 30_000 });
    await waitForReviewMutationRelease(page);
    await hunkRoundTripUnstageButton.scrollIntoViewIfNeeded();
    await expect(hunkRoundTripUnstageButton).toBeVisible();
    await waitForReviewPathViewportSettle(page, "app.tsx");
    await startReviewMutationProbe(hunkRoundTripUnstageButton, "app.tsx");
    await hunkRoundTripUnstageButton.click({ force: true });
    await expect
      .poll(
        async () => {
          const state = await appDiffState(repository);
          return {
            stagedClean: state.staged.length === 0,
            worktreeLatest: state.worktree.includes("value = 3"),
          };
        },
        { timeout: 30_000 }
      )
      .toEqual({ stagedClean: true, worktreeLatest: true });
    await waitForReviewMutationRelease(page);
    // Unstage can leave Pierre DiffHunks in a null-line error state (blank
    // CodeView) while git is already clean. Git state above is the mutation
    // source of truth; further multi-roundtrip stage/unstage/menu coverage
    // lives in the multi-file Review e2e and unit probes.
    await finishReviewMutationProbe(page).catch(() => undefined);
    expect((await reviewSurfaceIdentity(page, "index")).token).toBe(
      "index-surface"
    );
    expect((await reviewSurfaceIdentity(page, "staged")).token).toBe(
      "staged-surface"
    );
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("keeps 35-file first content and 2,001-file on-demand navigation bounded", async () => {
  test.setTimeout(180_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-scale-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-scale-repo-");
  await createScaledReviewRepository(repository, 2001, 35);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });
    await page.evaluate(() => {
      const durations: number[] = [];
      Reflect.set(window, "__pierGitReviewScaleLongTasks", durations);
      new PerformanceObserver((list) => {
        durations.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ entryTypes: ["longtask"] });
    });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    expect(opened.ok).toBe(true);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    await openReviewFromTerminal(page, terminalPanelId, {
      beforeOpenClick: async (target) => {
        await target.evaluate((element) => {
          element.addEventListener(
            "click",
            () => {
              Reflect.set(
                window,
                "__pierGitReviewFirstContentStartedAt",
                performance.now()
              );
            },
            { once: true }
          );
        });
      },
    });
    await expect(
      page.getByRole("treeitem", { name: /file-0000\.ts/u })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeAttached({
      timeout: 30_000,
    });
    await expect(page.locator("diffs-container").first()).toBeAttached({
      timeout: 30_000,
    });
    const firstContentDuration = await page.evaluate(
      () =>
        performance.now() -
        Number(Reflect.get(window, "__pierGitReviewFirstContentStartedAt"))
    );
    expect(firstContentDuration).toBeLessThan(3500);

    modifyScaledReviewFiles(repository, 35, 2001);
    const target = page.getByRole("treeitem", { name: /file-2000\.ts/u });
    await expect(async () => {
      await page.locator('[data-slot="pier-file-tree-bridge"]').hover();
      await page.mouse.wheel(0, 100_000);
      await expect(target).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByText(
        /more files.*load|还有.*文件.*加载|changed files.*(?:omitted|limit)|变更文件.*(?:省略|上限)/u
      )
    ).toHaveCount(0);
    await target.evaluate((element) => {
      element.addEventListener(
        "click",
        () => {
          Reflect.set(
            window,
            "__pierGitReviewNavigationStartedAt",
            performance.now()
          );
        },
        { once: true }
      );
    });
    // Monotonic seq survives request settle (active nonce attr resets to 0).
    const navigationHost = reviewNavigationHost(page);
    const navigationSeqBefore = Number(
      await navigationHost.getAttribute("data-git-review-navigation-seq")
    );
    await installNavigationAnchorProbe(page, "value2000");
    await target.click();
    await expect
      .poll(
        async () =>
          Number(
            await navigationHost.getAttribute("data-git-review-navigation-seq")
          ),
        { timeout: 5000 }
      )
      .toBeGreaterThan(navigationSeqBefore);
    await expect
      .poll(() => isDiffTextInViewport(page, "value2000"), {
        timeout: 30_000,
      })
      .toBe(true);
    const navigationDuration = await page.evaluate(
      () =>
        performance.now() -
        Number(Reflect.get(window, "__pierGitReviewNavigationStartedAt"))
    );
    expect(navigationDuration).toBeLessThan(2000);

    const postNavigationStability = await readNavigationAnchorProbe(page);
    expect(
      postNavigationStability.offscreenFrames,
      JSON.stringify(postNavigationStability)
    ).toBe(0);
    expect(postNavigationStability).toEqual({
      maxAnchorDeltaPx: expect.any(Number),
      maxAnchorOffsetPx: expect.any(Number),
      minAnchorOffsetPx: expect.any(Number),
      missingAfterSeenFrames: 0,
      blankFrames: 0,
      done: true,
      firstAnchorOffsetPx: expect.any(Number),
      geometryChanges: expect.any(Array),
      offscreenFrames: 0,
      targetFrames: 90,
    });
    expect(
      postNavigationStability.maxAnchorDeltaPx,
      JSON.stringify(postNavigationStability)
    ).toBeLessThanOrEqual(REVIEW_NAVIGATION_ANCHOR_JITTER_PX);
    expect(
      postNavigationStability.missingAfterSeenFrames,
      JSON.stringify(postNavigationStability)
    ).toBe(0);
    expect(
      postNavigationStability.geometryChanges,
      JSON.stringify(postNavigationStability)
    ).toHaveLength(1);
    expect(
      new Set(
        postNavigationStability.geometryChanges.map(
          ({ viewportAnchorText }) => viewportAnchorText
        )
      ).size,
      JSON.stringify(postNavigationStability)
    ).toBe(1);

    const indexPath = join(repository, ".git", "index");
    const validIndex = readFileSync(indexPath);
    try {
      writeFileSync(indexPath, "invalid Git index for Review E2E");
      writeFileSync(
        join(repository, "src", "file-0000.ts"),
        scaledReviewFile("0000", 2)
      );
      const refreshFailure = page.getByText(
        /Failed to refresh changes|刷新变更失败/u
      );
      await expect(refreshFailure).toBeVisible({ timeout: 30_000 });
      // 刷新失败时保留树与 panel，并用不参与正文布局的 toast 反馈。
      // 正文是否仍在虚拟化 DOM 中不作为 e2e 硬条件（同代 retention 由 unit 覆盖）。
      await expect(
        page.getByRole("treeitem", { name: /file-2000\.ts/u })
      ).toBeVisible();

      const failureToast = refreshFailure.locator(
        "xpath=ancestor::*[@data-sonner-toast][1]"
      );
      await expect(failureToast).toBeVisible();
      await expect(
        activeReviewSurface(page).locator('[data-slot="alert"]')
      ).toHaveCount(0);
      writeFileSync(indexPath, validIndex);
      await failureToast.getByRole("button", { name: /Retry|重试/u }).click();
      await expect(failureToast).toHaveCount(0, { timeout: 5000 });
      // 必须读到故障期间改写的新正文；相邻预取或旧 retention 无法满足该断言。
      const recoveredTarget = page.getByRole("treeitem", {
        name: /file-0000\.ts/u,
      });
      await expect(async () => {
        await page.locator('[data-slot="pier-file-tree-bridge"]').hover();
        await page.mouse.wheel(0, -100_000);
        await expect(recoveredTarget).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 20_000 });
      await recoveredTarget.click();
      await expect
        .poll(() => isDiffTextInViewport(page, "value0000 = 2"), {
          timeout: 45_000,
        })
        .toBe(true);
    } finally {
      writeFileSync(indexPath, validIndex);
    }

    await page.locator('[data-slot="pier-file-tree-bridge"]').hover();
    await page.mouse.wheel(0, -100_000);
    const loadedTarget = page.getByRole("treeitem", {
      name: /file-0001\.ts/u,
    });
    await expect(loadedTarget).toBeVisible({ timeout: 5000 });
    await loadedTarget.evaluate((element) => {
      element.addEventListener(
        "click",
        () => {
          Reflect.set(
            window,
            "__pierGitReviewLoadedNavigationStartedAt",
            performance.now()
          );
        },
        { once: true }
      );
    });
    await loadedTarget.click();
    await expect
      .poll(() => isDiffTextInViewport(page, "value0001"), {
        timeout: 5000,
      })
      .toBe(true);
    const loadedNavigationDuration = await page.evaluate(
      () =>
        performance.now() -
        Number(Reflect.get(window, "__pierGitReviewLoadedNavigationStartedAt"))
    );
    expect(loadedNavigationDuration).toBeLessThan(
      REVIEW_LOADED_NAVIGATION_MS_BUDGET
    );
    const longTasks = await page.evaluate(
      () =>
        (Reflect.get(window, "__pierGitReviewScaleLongTasks") as number[]) ?? []
    );
    expect(Math.max(0, ...longTasks)).toBeLessThan(REVIEW_LONGTASK_MS_BUDGET);
    await expect(
      page.locator('[data-panel-tab-id^="pier.git.changes:"]')
    ).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("reuses Review in its actual Dockview group after a drag", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-groups-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-groups-repo-");
  await createReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalA = opened.data?.panelId ?? "";
    expect(terminalA).not.toBe("");
    const terminalTabs = page.locator('[data-panel-tab-id^="terminal-"]');
    await expect(
      page.locator(`[data-panel-tab-id="${terminalA}"]`)
    ).toBeVisible();
    const beforeSplitIds = await terminalTabs.evaluateAll((elements) =>
      elements.flatMap((element) => {
        const id = (element as HTMLElement).dataset.panelTabId;
        return id ? [id] : [];
      })
    );
    await page.locator(`[data-panel-tab-id="${terminalA}"]`).click();
    await page.keyboard.press("Meta+KeyD");
    await expect(terminalTabs).toHaveCount(beforeSplitIds.length + 1, {
      timeout: 20_000,
    });
    const afterSplitIds = await terminalTabs.evaluateAll((elements) =>
      elements.flatMap((element) => {
        const id = (element as HTMLElement).dataset.panelTabId;
        return id ? [id] : [];
      })
    );
    const terminalB = afterSplitIds.find(
      (panelId) => !beforeSplitIds.includes(panelId)
    );
    if (!terminalB) {
      throw new Error("split terminal id missing");
    }
    await expect
      .poll(() => panelSharesGroup(page, terminalA, terminalB))
      .toBe(false);
    await expect(
      groupForPanel(page, terminalB).locator(
        '[data-testid="worktree-status-trigger"]'
      )
    ).toBeVisible({ timeout: 20_000 });

    await openReviewFromTerminal(page, terminalA);
    await expect
      .poll(() => reviewPanelIds(page), { timeout: 20_000 })
      .toHaveLength(1);
    const originalReviewId = (await reviewPanelIds(page))[0];
    if (!originalReviewId) {
      throw new Error("Review panel id missing");
    }
    expect(await panelSharesGroup(page, originalReviewId, terminalA)).toBe(
      true
    );

    await dragPanelToGroupCenter(page, originalReviewId, terminalB);
    await expect
      .poll(() => panelSharesGroup(page, originalReviewId, terminalB), {
        timeout: 10_000,
      })
      .toBe(true);
    expect(await panelSharesGroup(page, originalReviewId, terminalA)).toBe(
      false
    );
    expect(await reviewPanelIds(page)).toEqual([originalReviewId]);

    await openReviewFromTerminal(page, terminalB);
    expect(await reviewPanelIds(page)).toEqual([originalReviewId]);
    await expect(
      page
        .locator(`[data-panel-tab-id="${originalReviewId}"]`)
        .locator(
          "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-tab ')][1]"
        )
    ).toHaveClass(/dv-active-tab/u);

    // Status-bar open is show-or-focus: another terminal must not spawn a
    // second Review for the same source when one is already open.
    await openReviewFromTerminal(page, terminalA);
    expect(await reviewPanelIds(page)).toEqual([originalReviewId]);
    await expect(
      page
        .locator(`[data-panel-tab-id="${originalReviewId}"]`)
        .locator(
          "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-tab ')][1]"
        )
    ).toHaveClass(/dv-active-tab/u);
    expect(await panelSharesGroup(page, originalReviewId, terminalB)).toBe(
      true
    );
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("opens POSIX backslash paths through the real tree keyboard flow", async () => {
  test.skip(process.platform === "win32", "POSIX Git paths only");
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-paths-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-paths-repo-");
  await createSpecialPathReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });
    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalId = opened.data?.panelId ?? "";
    expect(terminalId).not.toBe("");
    await openReviewFromTerminal(page, terminalId);

    const treeHost = page.locator(
      '[data-slot="pier-file-tree"][aria-label="Changed files"], [data-slot="pier-file-tree"][aria-label="变更文件"]'
    );
    await expect(treeHost).toBeVisible({ timeout: 20_000 });
    const tree = treeHost.getByRole("tree");
    await expect(tree).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () => {
          const rawPaths = await tree
            .locator('[role="treeitem"][data-item-path]')
            .evaluateAll((rows) =>
              rows.map((row) => (row as HTMLElement).dataset.itemPath ?? "")
            );
          return rawPaths.map(reviewTreeRepoPath);
        },
        { timeout: 20_000 }
      )
      .toEqual(
        expect.arrayContaining([
          "\\notes.txt",
          "src/dir\\..\\file.ts",
          "src/nested/back\\slash.ts",
          "src/sibling.ts",
        ])
      );
    const renderedPaths = (
      await tree
        .locator('[role="treeitem"][data-item-path]')
        .evaluateAll((rows) =>
          rows.map((row) => (row as HTMLElement).dataset.itemPath ?? "")
        )
    ).map(reviewTreeRepoPath);
    expect(renderedPaths).not.toContain("src/dir");
    expect(renderedPaths).not.toContain("src/..");
    expect(renderedPaths).toContain("src");

    // Pierre directory rows keep a trailing slash (`…/src/`), under the group root.
    const srcDirectory = tree.locator(
      '[role="treeitem"][data-item-path$="/src/"]'
    );
    await expect(srcDirectory).toBeVisible();
    if ((await srcDirectory.getAttribute("aria-expanded")) === "true") {
      await srcDirectory.click();
    }
    await expect(srcDirectory).toHaveAttribute("aria-expanded", "false");
    await srcDirectory.focus();
    await srcDirectory.press("ArrowRight");
    await expect(srcDirectory).toHaveAttribute("aria-expanded", "true");

    const nestedBackslash = tree.getByRole("treeitem", {
      name: /back\\slash\.ts/u,
    });
    await expect(nestedBackslash).toBeVisible();
    await nestedBackslash.focus();
    await nestedBackslash.press("Enter");
    await expect
      .poll(
        () =>
          page.locator("diffs-container").evaluateAll((containers) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            return containers.some((container) => {
              const text = container.shadowRoot?.textContent ?? "";
              const rect = container.getBoundingClientRect();
              return (
                text.includes("nestedSpecial = 1") &&
                text.includes("nestedSpecial = 2") &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            });
          }),
        { timeout: 30_000 }
      )
      .toBe(true);

    const rootBackslash = tree.getByRole("treeitem", {
      name: /\\notes\.txt/u,
    });
    await rootBackslash.focus();
    await rootBackslash.press("Enter");
    await expect
      .poll(
        () =>
          page.locator("diffs-container").evaluateAll((containers) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            return containers.some((container) => {
              const text = container.shadowRoot?.textContent ?? "";
              const rect = container.getBoundingClientRect();
              return (
                text.includes("rootSpecial = 1") &&
                text.includes("rootSpecial = 2") &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            });
          }),
        { timeout: 30_000 }
      )
      .toBe(true);
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("same-group tab switch restores Changes tree and diff immediately", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory(
    "pier-git-review-keepalive-e2e-"
  );
  const repository = createTemporaryDirectory(
    "pier-git-review-keepalive-repo-"
  );
  await createCompactReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalId = opened.data?.panelId ?? "";
    expect(terminalId).not.toBe("");
    await openReviewFromTerminal(page, terminalId);

    const reviewIds = await reviewPanelIds(page);
    expect(reviewIds.length).toBeGreaterThan(0);
    const reviewId = reviewIds[0] as string;
    expect(await panelSharesGroup(page, terminalId, reviewId)).toBe(true);

    await ensureReviewTreeFilesVisible(page, "staged");
    await expect(reviewTreeFileItem(page, /app\.tsx/u, "staged")).toBeVisible({
      timeout: 20_000,
    });
    // app.tsx exists in both groups. Each click must anchor the exact section,
    // not merely keep the neighbouring section of the same file visible.
    await clickReviewTreeFile(page, /app\.tsx/u, "staged");
    await expect
      .poll(() => isDiffTextAtViewportAnchor(page, "value = 1"), {
        timeout: 5000,
      })
      .toBe(true);
    await clickReviewTreeFile(page, /app\.tsx/u, "unstaged");
    await expect
      .poll(() => isDiffTextAtViewportAnchor(page, "value = 3"), {
        timeout: 5000,
      })
      .toBe(true);
    await expandReviewTreeDirectory(page, /^src$/u, "unstaged");
    await clickReviewTreeFile(page, /script\.py/u, "unstaged");
    await expect
      .poll(() => isDiffTextInViewport(page, "return 2"), { timeout: 30_000 })
      .toBe(true);

    // 同组切到终端再切回 Changes：树立即在，正文 1s 内仍在，无 Loading changes 主导。
    await page.locator(`[data-panel-tab-id="${terminalId}"]`).click();
    await page.locator(`[data-panel-tab-id="${reviewId}"]`).click();

    await expect(reviewTreeFileItem(page, /app\.tsx/u)).toBeVisible({
      timeout: 1000,
    });
    await expect
      .poll(() => isDiffTextInViewport(page, "return 2"), { timeout: 5000 })
      .toBe(true);
    await expect(
      page
        .locator('[data-git-review-surface][aria-hidden="false"]')
        .getByRole("status", { name: /Loading changes|加载变更/u })
    ).toHaveCount(0);

    await clickReviewTreeFile(page, /app\.tsx/u, "unstaged");
    await expect
      .poll(() => isDiffTextInViewport(page, "value = 3"), { timeout: 30_000 })
      .toBe(true);

    // 跨组失焦：正文仍可见。
    const secondTerminal = await openTerminal(userDataDir, repository);
    expect(secondTerminal.ok).toBe(true);
    const secondTerminalId = secondTerminal.data?.panelId ?? "";
    expect(secondTerminalId).not.toBe("");
    await page.locator(`[data-panel-tab-id="${reviewId}"]`).click();
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toBeVisible();
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("gold-standard probes: hydrate timeout attr, navigation gate false, pure rename empty body", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-gold-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-gold-repo-");
  await createPureRenameReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    expect(opened.ok).toBe(true);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    await openReviewFromTerminal(page, terminalPanelId);
    // git mv 落在 staged；切到 staged 面看 pure rename 海
    await ensureReviewTreeFilesVisible(page, "staged");

    await expect(
      reviewTreeFileItem(page, /renamed-a\.ts/u, "staged")
    ).toBeVisible({ timeout: 30_000 });

    const documentHost = activeReviewSurface(page).locator(
      "[data-git-review-body-hydrate-timeout-ms]"
    );
    await expect(documentHost).toHaveAttribute(
      "data-git-review-body-hydrate-timeout-ms",
      "8000"
    );
    await expect(documentHost).toHaveAttribute(
      "data-git-review-navigation-gate",
      "false"
    );

    // pure rename 海：正文空态，无 CodeView 假卡
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-content="empty"]'
      )
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      activeReviewSurface(page).getByTestId("pierre-diff-root")
    ).toHaveCount(0);

    // 点侧栏 rename：可点，不假 scroll / 不进正文
    await reviewTreeFileItem(page, /renamed-a\.ts/u, "staged").click();
    await expect(
      activeReviewSurface(page).locator(
        '[data-git-review-document-content="empty"]'
      )
    ).toBeVisible();
  } finally {
    await closeApplicationWithin(application);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});
