import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Menu, PopupOptions } from "electron";
import { setWindowSize } from "../support/app-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const execFileAsync = promisify(execFile);
const MENU_STATE_KEY = "__pierConflictE2eNativeMenu";

interface NativeMenuState {
  menu: Menu | null;
  readonly original: Menu["popup"];
}

export interface ConflictFixture {
  readonly app: ElectronApplication;
  readonly errors: string[];
  readonly git: (...args: string[]) => Promise<string>;
  readonly page: Page;
  readonly repository: string;
}

export const incomingText = (path: string): string =>
  `before ${path}\nincoming ${path}\nafter ${path}\n`;
export const currentText = (path: string): string =>
  `before ${path}\ncurrent ${path}\nafter ${path}\n`;
export const MANUAL_RESOLUTION = "manually reviewed final text\n";

async function createRepository(
  repository: string,
  kind: "markers" | "file-level"
): Promise<ConflictFixture["git"]> {
  const git = async (...args: string[]) => {
    const { stdout } = await execFileAsync("git", args, { cwd: repository });
    return stdout;
  };
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "conflicts@pier.test");
  await git("config", "user.name", "Pier Conflict E2E");
  await git("config", "commit.gpgsign", "false");
  await git("config", "merge.conflictStyle", "merge");
  await git("config", "core.autocrlf", "false");
  const paths =
    kind === "markers"
      ? ["alpha.txt", "beta.txt"]
      : ["delete.txt", "incoming.txt", "stage.txt"];
  for (const path of paths) {
    writeFileSync(
      join(repository, path),
      `before ${path}\nbase ${path}\nafter ${path}\n`
    );
  }
  writeFileSync(join(repository, "ordinary.txt"), "ordinary base\n");
  await git("add", ".");
  await git("commit", "-q", "-m", "base");
  await git("checkout", "-q", "-b", "incoming");
  for (const path of paths) {
    if (kind === "file-level" && path === "delete.txt") {
      await git("rm", "--", path);
    } else {
      writeFileSync(join(repository, path), incomingText(path));
    }
  }
  await git("add", ".");
  await git("commit", "-q", "-m", "incoming changes");
  await git("checkout", "-q", "main");
  for (const path of paths) {
    if (kind === "file-level" && path === "incoming.txt") {
      await git("rm", "--", path);
    } else {
      writeFileSync(join(repository, path), currentText(path));
    }
  }
  await git("add", ".");
  await git("commit", "-q", "-m", "current changes");
  await expect(git("merge", "--no-edit", "incoming")).rejects.toMatchObject({
    code: 1,
  });
  if (kind === "file-level") {
    // A human already removed the markers, but the real index is still unmerged.
    writeFileSync(join(repository, "stage.txt"), MANUAL_RESOLUTION);
  }
  writeFileSync(join(repository, "ordinary.txt"), "ordinary working change\n");
  const status = await git("status", "--porcelain=v1");
  for (const [path, xy] of kind === "markers"
    ? [
        ["alpha.txt", "UU"],
        ["beta.txt", "UU"],
      ]
    : [
        ["delete.txt", "UD"],
        ["incoming.txt", "DU"],
        ["stage.txt", "UU"],
      ]) {
    expect(status.split("\n")).toContain(`${xy} ${path}`);
  }
  return git;
}

async function openReview(
  fixture: ConflictFixture,
  userDataDir: string
): Promise<void> {
  const { app, page, repository } = fixture;
  await page.waitForLoadState("domcontentloaded");
  await expect(
    page.locator(
      '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
    )
  ).toBeVisible({ timeout: 30_000 });
  await setWindowSize(app, page, 1400, 900);
  let terminalId = "";
  await expect(async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        join(PROJECT_ROOT, "bin", "pier.mjs"),
        "terminal",
        "open",
        "--cwd",
        repository,
        "--json",
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
      }
    );
    const result = JSON.parse(stdout) as {
      ok?: boolean;
      data?: { panelId?: string };
    };
    expect(result.ok).toBe(true);
    terminalId = result.data?.panelId ?? "";
    expect(terminalId).not.toBe("");
  }).toPass({ timeout: 15_000 });
  const tab = page.locator(`[data-panel-tab-id="${terminalId}"]`);
  await tab.click();
  const group = tab.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-groupview ')][1]"
  );
  const changes = group.getByTestId("git-changes-status-trigger");
  await expect(group.getByTestId("worktree-status-trigger")).toBeVisible({
    timeout: 20_000,
  });
  // Identity paints before the first dirty-status poll; wait for its real action.
  await expect(changes).toBeVisible({ timeout: 20_000 });
  await changes.click();
  await expect(
    page.locator('[data-panel-tab-id^="pier.git.changes:"]')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("git-review-tree")).toBeVisible();
  await expect(
    page.locator(
      '[data-git-review-surface="conflict"][aria-hidden="false"] [data-testid="pierre-diff-root"]'
    )
  ).toBeVisible({ timeout: 30_000 });
}

export async function withConflictReview(
  kind: "markers" | "file-level",
  exercise: (fixture: ConflictFixture) => Promise<void>
): Promise<void> {
  const repository = realpathSync(
    mkdtempSync(join(tmpdir(), "pier-conflict-repo-"))
  );
  const userDataDir = realpathSync(
    mkdtempSync(join(tmpdir(), "pier-conflict-profile-"))
  );
  let app: ElectronApplication | undefined;
  try {
    const git = await createRepository(repository, kind);
    app = await electron.launch({
      args: [
        join(PROJECT_ROOT, "out", "main", "index.js"),
        `--user-data-dir=${userDataDir}`,
      ],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        CODEX_HOME: join(userDataDir, "codex-home"),
        ELECTRON_USER_DATA_DIR: userDataDir,
        ELECTRON_RENDERER_URL: "",
      },
      timeout: 30_000,
    });
    const errors: string[] = [];
    const page = await app.firstWindow({ timeout: 30_000 });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    // Observe the real native popup, retaining its real enabled MenuItems.
    // Do not replace the IPC result or dispatch a plugin action directly.
    await app.evaluate(({ Menu: NativeMenu }, key) => {
      const state: NativeMenuState = {
        original: NativeMenu.prototype.popup,
        menu: null,
      };
      Reflect.set(globalThis, key, state);
      NativeMenu.prototype.popup = function (
        this: Menu,
        options?: PopupOptions
      ) {
        state.menu = this;
        state.original.call(this, options);
      };
    }, MENU_STATE_KEY);
    const fixture = { app, page, repository, errors, git };
    await openReview(fixture, userDataDir);
    await exercise(fixture);
    expect(
      errors.filter((error) =>
        /undeclared|not declared|capability|unauthorized|resolveReviewConflict.*(?:failed|denied)|resolveConflict.*(?:declared|registered)/iu.test(
          error
        )
      ),
      errors.join("\n")
    ).toEqual([]);
  } finally {
    if (app) {
      await app
        .evaluate(({ Menu: NativeMenu }, key) => {
          const state = Reflect.get(globalThis, key) as
            | NativeMenuState
            | undefined;
          if (!state) return;
          state.menu?.closePopup();
          NativeMenu.prototype.popup = state.original;
          Reflect.deleteProperty(globalThis, key);
        }, MENU_STATE_KEY)
        .catch(() => undefined);
      const child = app.process();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        app.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve())
        );
        child.kill("SIGKILL");
        await exited;
      }
    }
    rmSync(repository, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

/** Playwright cannot locate OS-native menus; select a real popup MenuItem. */
export async function chooseNativeMenu(
  fixture: ConflictFixture,
  target: Locator,
  name: RegExp
): Promise<void> {
  const { app } = fixture;
  await app.evaluate((_electron, key) => {
    const state = Reflect.get(globalThis, key) as NativeMenuState;
    state.menu = null;
  }, MENU_STATE_KEY);
  await target.click({ button: "right" });
  await expect
    .poll(() =>
      app.evaluate((_electron, key) => {
        const state = Reflect.get(globalThis, key) as NativeMenuState;
        return state.menu !== null;
      }, MENU_STATE_KEY)
    )
    .toBe(true);
  await app.evaluate(
    (_electron, args) => {
      const state = Reflect.get(globalThis, args.key) as NativeMenuState;
      const menu = state.menu;
      if (!menu) throw new Error("Expected a real native context menu");
      const matches = menu.items.filter((item) =>
        new RegExp(args.pattern, args.flags).test(item.label)
      );
      if (matches.length !== 1) {
        throw new Error(
          `Expected one menu item, got ${matches.length}: ${menu.items.map((item) => item.label).join(", ")}`
        );
      }
      const item = matches[0];
      if (!(item?.enabled && item.visible))
        throw new Error("Native menu action is unavailable");
      item.click(item);
      menu.closePopup();
    },
    { key: MENU_STATE_KEY, pattern: name.source, flags: name.flags }
  );
}
