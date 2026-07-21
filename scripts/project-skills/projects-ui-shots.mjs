// Screenshot pass for Projects settings shell (list + Environment/Skills/General).
// Usage: node scripts/project-skills/projects-ui-shots.mjs
// Requires: pnpm build (out/main/index.js)
// Output: /tmp/pier-projects-ui/shots/*.png + manifest.json

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const REPO = new URL("../..", import.meta.url).pathname;
const OUT_MAIN = join(REPO, "out", "main", "index.js");
const BASE = "/tmp/pier-projects-ui";
const SHOTS = join(BASE, "shots");
const HOME = join(BASE, "home");
const PROJECT = join(BASE, "project");
const PROJECT_EMPTY = join(BASE, "project-empty");
const USER_DATA = join(BASE, "user-data");

const manifest = [];

function sh(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "pipe", ...opts });
}

function writeSkill(root, id, frontmatter, body) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

function buildFixture() {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(USER_DATA, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  mkdirSync(PROJECT, { recursive: true });
  sh("git", ["init", "-q"], { cwd: PROJECT });
  writeFileSync(join(PROJECT, "README.md"), "# QA fixture\n");
  writeSkill(
    join(PROJECT, ".agents", "skills"),
    "review-guide",
    'name: review-guide\ndescription: "How to review PRs in this repo."',
    "# Review guide\n\nRead the diff twice."
  );
  sh("git", ["add", "."], { cwd: PROJECT });
  sh(
    "git",
    [
      "-c",
      "user.email=qa@pier.local",
      "-c",
      "user.name=QA",
      "commit",
      "-qm",
      "fixture",
    ],
    { cwd: PROJECT }
  );

  mkdirSync(PROJECT_EMPTY, { recursive: true });
  sh("git", ["init", "-q"], { cwd: PROJECT_EMPTY });
  writeFileSync(join(PROJECT_EMPTY, "README.md"), "# empty\n");

  writeFileSync(
    join(USER_DATA, "local-environments.json"),
    JSON.stringify(
      {
        projects: [
          { projectRootPath: PROJECT },
          { projectRootPath: PROJECT_EMPTY },
        ],
        version: 1,
        worktreeBindings: [],
      },
      null,
      2
    )
  );

  mkdirSync(join(PROJECT, ".pier"), { recursive: true });
  writeFileSync(
    join(PROJECT, ".pier", "environment.json"),
    JSON.stringify(
      {
        cleanupCommand: "pnpm cleanup:worktree",
        copyPatterns: [".env*"],
        env: { NODE_ENV: "development" },
        setupCommand: "pnpm setup:worktree",
        updatedAt: 1,
        version: 1,
      },
      null,
      2
    )
  );
}

async function shot(win, name, note) {
  await win.waitForTimeout(500);
  const file = join(
    SHOTS,
    `${String(manifest.length + 1).padStart(2, "0")}-${name}.png`
  );
  await win.screenshot({ path: file });
  manifest.push({ file, name, note });
  process.stdout.write(`shot ${file}\n`);
}

async function openProjectsSettings(win) {
  await win.keyboard.press("Meta+Comma");
  await win
    .locator('[role="dialog"][data-state="open"]')
    .waitFor({ timeout: 10_000 });
  const nav = win.locator('[data-testid="settings-nav-projects"]');
  await nav.waitFor({ timeout: 10_000 });
  await nav.click();
  await win.waitForTimeout(600);
}

async function activateTab(win, name) {
  const tab = win.getByRole("tab", { name });
  await tab.click({ trial: true }).catch(() => undefined);
  await tab.dispatchEvent("mousedown", { button: 0 });
  await tab.click();
  await win.waitForTimeout(400);
}

async function main() {
  buildFixture();

  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${USER_DATA}`],
    cwd: REPO,
    env: {
      ...process.env,
      HOME,
      LANG: "zh_CN.UTF-8",
      PIER_TEST_DISABLE_QUIT_CONFIRMATION: "1",
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.locator(".terminal-anchor").first().waitFor({ timeout: 20_000 });
  await win.waitForTimeout(1200);

  await openProjectsSettings(win);

  // May land on detail if active project matches; go list first.
  const back = win.getByRole("button", {
    name: /返回项目列表|Back to projects/,
  });
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await win.waitForTimeout(400);
  }
  await shot(win, "project-list", "项目列表（有项目）");

  // Empty state: open empty project folder isn't empty list — capture empty via
  // removing isn't easy mid-run; instead open detail tabs on main project.
  const projectRow = win.getByText("project", { exact: true }).first();
  await projectRow.click();
  await win.waitForTimeout(500);

  await activateTab(win, /环境|Environment/);
  await win
    .getByText(/Setup command|Setup 命令|启动命令/)
    .waitFor({
      timeout: 8000,
    })
    .catch(() => undefined);
  await shot(win, "detail-environment", "详情 · 环境 Tab（line tabs）");

  await activateTab(win, /技能|Skills/);
  await win.waitForTimeout(800);
  await shot(win, "detail-skills", "详情 · 技能 Tab");

  await activateTab(win, /常规|General/);
  await win
    .getByText("发现路径")
    .or(win.getByText("Discovery paths"))
    .first()
    .waitFor({
      timeout: 10_000,
    });
  await shot(win, "detail-general", "详情 · 常规 Tab（发现路径 + 删除）");

  await activateTab(win, /技能|Skills/);
  const openBtn = win.getByRole("button", { name: /打开|Open/ }).first();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
    await win.waitForTimeout(800);
    await shot(win, "skill-open", "技能 · 打开（编辑/只读）");
  }

  // Empty list: close and clear — open settings with only empty project by
  // going back and using second project if list still multi.
  const back2 = win.getByRole("button", {
    name: /返回项目列表|Back to projects/,
  });
  if (await back2.isVisible().catch(() => false)) {
    await back2.click();
    await win.waitForTimeout(400);
  }
  // Prefer skill-level back if still in skill detail.
  const backSkill = win.getByRole("button", {
    name: /返回项目列表|Back to projects/,
  });
  if (await backSkill.isVisible().catch(() => false)) {
    await backSkill.click();
    await win.waitForTimeout(400);
  }

  writeFileSync(join(BASE, "manifest.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(`manifest ${join(BASE, "manifest.json")}\n`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
