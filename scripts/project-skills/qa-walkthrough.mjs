// Manual-QA walkthrough driver for the project-skills settings section.
// Launches the built Electron app against a disposable fixture (project with
// unmanaged skills + fake HOME with user-global skills + seeded environment
// index), walks every skills surface, and saves screenshots for review.
//
// Usage: node scripts/project-skills/qa-walkthrough.mjs
// Output: /tmp/pier-skills-qa/shots/*.png + manifest.json (+ console errors)

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const REPO = new URL("../..", import.meta.url).pathname;
const OUT_MAIN = join(REPO, "out", "main", "index.js");
const BASE = "/tmp/pier-skills-qa";
const SHOTS = join(BASE, "shots");
const HOME = join(BASE, "home");
const PROJECT = join(BASE, "project");
const PROJECT_EMPTY = join(BASE, "project-empty");
const USER_DATA = join(BASE, "user-data");

const manifest = [];
const consoleErrors = [];

function sh(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "pipe", ...opts });
}

function writeSkill(root, id, frontmatter, body) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
  return dir;
}

function buildFixture() {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(USER_DATA, { recursive: true });
  mkdirSync(HOME, { recursive: true });

  // User-global skills (fake HOME).
  writeSkill(
    join(HOME, ".claude", "skills"),
    "code-review-notes",
    'name: code-review-notes\ndescription: "Personal review checklist used across projects."',
    "# Code review notes\n\n- Prefer small diffs\n- Check error paths"
  );
  writeSkill(
    join(HOME, ".agents", "skills"),
    "team-conventions",
    'name: team-conventions\ndescription: "Cross-project naming and commit conventions."',
    "# Team conventions\n\nUse conventional commits."
  );

  // Fixture project with two unmanaged skills (one risky).
  mkdirSync(PROJECT, { recursive: true });
  sh("git", ["init", "-q"], { cwd: PROJECT });
  writeFileSync(join(PROJECT, "README.md"), "# QA fixture\n");
  writeSkill(
    join(PROJECT, ".agents", "skills"),
    "review-guide",
    'name: review-guide\ndescription: "How to review PRs in this repo."',
    "# Review guide\n\nRead the diff twice. Run `pnpm test` before approving."
  );
  const risky = writeSkill(
    join(PROJECT, ".claude", "skills"),
    "deploy-checklist",
    'name: deploy-checklist\ndescription: "Steps to deploy to production."',
    "# Deploy\n\nRun `./scripts/release.sh` then `curl -X POST $HOOK`."
  );
  mkdirSync(join(risky, "scripts"), { recursive: true });
  writeFileSync(
    join(risky, "scripts", "release.sh"),
    "#!/bin/sh\necho deploy\n",
    {
      mode: 0o755,
    }
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

  // Second, empty project (empty-state coverage).
  mkdirSync(PROJECT_EMPTY, { recursive: true });
  sh("git", ["init", "-q"], { cwd: PROJECT_EMPTY });
  writeFileSync(join(PROJECT_EMPTY, "README.md"), "# empty\n");

  // Seed the shared environment index so both projects appear as
  // source=environment entries in the skills project list.
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
}

async function shot(win, name, note) {
  // Wait for UI to settle (animations, async loads).
  await win.waitForTimeout(450);
  const file = join(
    SHOTS,
    `${String(manifest.length + 1).padStart(2, "0")}-${name}.png`
  );
  await win.screenshot({ path: file });
  if (process.env.PIER_QA_OVERFLOW_PROBE === "1") {
    const offenders = await win.evaluate(() => {
      const main = document.querySelector("main");
      if (!main || main.scrollWidth <= main.clientWidth + 1) return [];
      const limit = main.getBoundingClientRect().left + main.clientWidth;
      const out = [];
      for (const el of main.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        if (rect.right > limit + 1 && rect.width > 0) {
          const hasWideChild = [...el.children].some(
            (child) => child.getBoundingClientRect().right > limit + 1
          );
          if (!hasWideChild) {
            out.push(
              `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 110)} right=${Math.round(rect.right)} limit=${Math.round(limit)}`
            );
          }
        }
      }
      return out.slice(0, 10);
    });
    if (offenders.length > 0) {
      process.stdout.write(`OVERFLOW ${name}:\n  ${offenders.join("\n  ")}\n`);
    }
  }
  manifest.push({ file, name, note });
  process.stdout.write(`shot ${file}\n`);
}

async function openSettingsSkills(win) {
  await win.keyboard.press("Meta+Comma");
  await win
    .locator('[role="dialog"][data-state="open"]')
    .waitFor({ timeout: 10_000 });
  await win.locator('[data-testid="settings-nav-skills"]').click();
  await win.waitForTimeout(600);
}

/**
 * Accept up to `max` sequential confirmation dialogs after an apply click,
 * screenshotting the first one under `shotName`.
 */
async function settleConfirms(win, shotName, note, max = 4) {
  for (let index = 0; index < max; index += 1) {
    await win.waitForTimeout(700);
    const dialog = win.locator('[role="alertdialog"]');
    if (!(await dialog.isVisible().catch(() => false))) {
      break;
    }
    if (index === 0 && shotName) {
      await shot(win, shotName, note);
    }
    await dialog.getByRole("button").last().click();
  }
  await win.waitForTimeout(1800);
}

async function main() {
  buildFixture();

  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${USER_DATA}`],
    cwd: REPO,
    env: {
      ...process.env,
      HOME,
      CODEX_HOME: join(USER_DATA, "codex-home"),
      PIER_TEST_DISABLE_QUIT_CONFIRMATION: "1",
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  win.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await win.locator(".terminal-anchor").first().waitFor({ timeout: 20_000 });
  await win.waitForTimeout(1500);

  // --- 1. Active project entry + projects list -------------------------
  await openSettingsSkills(win);
  await shot(
    win,
    "active-project-direct",
    "当前打开的项目直接进入技能详情，不以共享索引为门槛"
  );
  const backToProjects = win.getByRole("button", { name: "返回项目列表" });
  if (await backToProjects.isVisible().catch(() => false)) {
    await backToProjects.click();
    await win.waitForTimeout(500);
  }
  await shot(win, "projects-list", "技能设置入口：项目列表（含 2 个环境项目）");

  // --- 2. Project detail (unified list) --------------------------------
  await win.getByText("project", { exact: true }).first().click();
  await win.getByText("review-guide").first().waitFor({ timeout: 10_000 });
  await shot(
    win,
    "project-detail-initial",
    "项目详情：未管理技能 + 用户全局技能统一列表"
  );

  // --- 3. Read-only detail for a project skill -------------------------
  await win
    .locator("li", { hasText: "review-guide" })
    .first()
    .getByRole("button", { name: "打开" })
    .click();
  await win.getByText("SKILL.md 内容").waitFor({ timeout: 10_000 });
  await shot(
    win,
    "readonly-detail-project",
    "项目技能只读详情（含内容 + 矩阵）"
  );

  // --- 4. Import as managed → inspection page --------------------------
  await win.getByRole("button", { name: /导入为 Pier (管理|托管)/ }).click();
  await win.getByText("检查导入", { exact: true }).waitFor({ timeout: 10_000 });
  await shot(win, "import-inspection", "导入检查页（来源/正文/风险/初始状态）");

  // --- 5. Add immediately. No draft, pending card, or global Apply. -----
  await win.getByRole("button", { name: "添加技能" }).click();
  await win.waitForTimeout(1800);
  await shot(win, "after-add", "添加后立即回到磁盘事实（无底栏/待应用状态）");

  // --- 7. Enabling projects immediately. A foreign projection target must
  // surface a readable blocked state and roll the switch back.
  const managedRow = win.locator("li", { hasText: "review-guide" }).first();
  const managedSwitch = managedRow.getByRole("switch");
  await managedSwitch.click();
  await win.waitForTimeout(2200);
  await shot(
    win,
    "conflict-blocked",
    "占用冲突：单次动作被阻断并给出可读下一步"
  );
  const alertOk = win
    .locator('[role="alertdialog"]')
    .getByRole("button")
    .last();
  if (await alertOk.isVisible().catch(() => false)) {
    await alertOk.click();
  }
  if (await managedSwitch.isChecked()) {
    throw new Error("blocked enable did not roll the switch back");
  }

  // --- 8. Blank template skill: no conflict → enable → projection --------
  await win.getByRole("button", { name: "添加技能" }).click();
  await win.getByText("新建空白技能").click();
  await win.waitForTimeout(600);
  // v8.2 single content-dialog form (id + description); falls back to the
  // legacy two-prompt chain when only one input is present.
  // Scope to the topmost dialog (the settings dialog is also role=dialog).
  const blankDialog = win
    .locator('[role="dialog"], [role="alertdialog"]')
    .last();
  const blankInputs = blankDialog.locator("input, textarea");
  await blankInputs.first().waitFor({ timeout: 5000 });
  await shot(win, "blank-prompt", "新建空白技能：表单/输入弹窗");
  if ((await blankInputs.count()) >= 2) {
    await blankInputs.nth(0).fill("release-notes");
    await blankInputs
      .nth(1)
      .fill("Draft release notes for each tagged version.");
    await blankDialog.getByRole("button").last().click();
  } else {
    await blankInputs.first().fill("release-notes");
    await win
      .locator('[role="alertdialog"]')
      .getByRole("button")
      .last()
      .click();
    await win
      .getByRole("heading", { name: "技能描述" })
      .waitFor({ timeout: 5000 });
    await win
      .locator('[role="alertdialog"] input')
      .fill("Draft release notes for each tagged version.");
    await win
      .locator('[role="alertdialog"]')
      .getByRole("button")
      .last()
      .click();
  }
  await win
    .getByText("检查新技能", { exact: true })
    .waitFor({ timeout: 10_000 });
  await shot(win, "blank-template-inspection", "空白模板检查页（本机添加）");
  await win.getByRole("button", { name: "添加技能" }).click();
  await win.waitForTimeout(1800);

  // Enabling is itself the complete user intent. It must project immediately,
  // without an intermediate page or content confirmation.
  const blankRow = win.locator("li", { hasText: "release-notes" }).first();
  const blankSwitch = blankRow.getByRole("switch");
  await blankSwitch.click();
  await win.waitForTimeout(2500);
  if (!(await blankSwitch.isChecked())) {
    throw new Error("enabled skill switch did not remain on");
  }
  const projectionPath = join(PROJECT, ".agents", "skills", "release-notes");
  if (
    !(existsSync(projectionPath) && lstatSync(projectionPath).isSymbolicLink())
  ) {
    throw new Error("enabled skill was not projected as a symlink");
  }
  const projectionTarget = readlinkSync(projectionPath);
  if (projectionTarget !== "../../.pier/skills/library/release-notes") {
    throw new Error(`unexpected projection target: ${projectionTarget}`);
  }
  await shot(win, "enabled-projection", "打开开关后立即创建受管相对链接");

  // --- 9a. Toggle off and back on; both are immediate disk actions. --------
  await blankSwitch.click();
  await win.waitForTimeout(2500);
  if (existsSync(projectionPath)) {
    throw new Error("disabled skill projection still exists");
  }
  await shot(win, "immediate-disable", "关闭开关后立即移除受管投影");
  await blankSwitch.click();
  await win.waitForTimeout(2500);
  if (!((await blankSwitch.isChecked()) && existsSync(projectionPath))) {
    throw new Error("re-enabled skill projection was not restored");
  }

  // --- 9-drift. External library change → integrity adoption -------------
  const manifestPath = join(PROJECT, ".pier", "skills", "manifest.json");
  const digestBeforeDrift = JSON.parse(
    readFileSync(manifestPath, "utf8")
  ).skills.find((skill) => skill.id === "release-notes")?.contentDigest;
  writeFileSync(
    join(PROJECT, ".pier", "skills", "library", "release-notes", "SKILL.md"),
    "---\nname: release-notes\ndescription: tampered\n---\n\n# tampered\n"
  );
  await win.getByRole("button", { name: "返回项目列表" }).click();
  await win.waitForTimeout(500);
  await win.getByText("project", { exact: true }).first().click();
  await win.getByText("release-notes").first().waitFor({ timeout: 10_000 });
  await win.waitForTimeout(1200);
  await shot(win, "drift-list", "外部篡改后的列表（漂移状态）");
  await win
    .locator("li", { hasText: "release-notes" })
    .first()
    .getByRole("button", { name: "打开" })
    .click();
  await win.waitForTimeout(1000);
  await shot(win, "drift-detail", "内容完整性漂移：提供采用当前文件操作");
  const adoptCurrentFiles = win.getByRole("button", {
    name: "采用当前文件",
    exact: true,
  });
  await adoptCurrentFiles.click();
  await win.waitForTimeout(900);
  const adoptConfirmation = win.getByRole("button", {
    name: "采用当前文件",
    exact: true,
  });
  if (
    (await adoptConfirmation.isVisible().catch(() => false)) &&
    (await adoptConfirmation.isEnabled())
  ) {
    await shot(win, "drift-adoption", "采用磁盘当前内容的完整性确认");
    await adoptConfirmation.click();
  }
  await win.waitForTimeout(1800);
  const digestAfterAdoption = JSON.parse(
    readFileSync(manifestPath, "utf8")
  ).skills.find((skill) => skill.id === "release-notes")?.contentDigest;
  if (!digestAfterAdoption || digestAfterAdoption === digestBeforeDrift) {
    throw new Error("Use current files did not adopt the current tree digest");
  }
  if (!existsSync(projectionPath)) {
    throw new Error("integrity adoption removed an enabled projection");
  }
  await shot(
    win,
    "drift-adopted",
    "采用当前文件后摘要更新，已启用投影保持可用"
  );
  const backAfterAdoption = win.getByRole("button", { name: "返回技能列表" });
  if (await backAfterAdoption.isVisible().catch(() => false)) {
    await backAfterAdoption.click();
    await win.waitForTimeout(500);
  }

  // --- 9b. Delete managed skill → content-delete confirm ------------------
  await blankRow.getByRole("button", { name: "打开" }).click();
  await win
    .getByRole("button", { name: "删除此技能" })
    .waitFor({ timeout: 5000 });
  await win.getByRole("button", { name: "删除此技能" }).click();
  await win.waitForTimeout(900);
  await shot(win, "content-delete-confirm", "删除动作内的精确确认");
  await settleConfirms(win, null, null);
  await shot(win, "after-delete", "删除后的列表");

  // --- 10. Managed skill detail ------------------------------------------
  await win
    .locator("li", { hasText: "review-guide" })
    .first()
    .getByRole("button", { name: "打开" })
    .click();
  await win.getByText("SKILL.md 内容").waitFor({ timeout: 10_000 });
  await win.waitForTimeout(800);
  await shot(win, "managed-detail", "托管技能详情：基本信息 + 矩阵 + 内容");

  // --- 11. Edit mode -----------------------------------------------------
  await win.getByRole("button", { name: "编辑内容" }).click();
  await win.locator("textarea").waitFor({ timeout: 5000 });
  await shot(win, "managed-edit", "编辑模式（预填当前 SKILL.md）");
  await win.getByRole("button", { name: "放弃编辑" }).click();
  await win.getByRole("button", { name: "返回技能列表" }).click();
  await win.waitForTimeout(500);

  // --- 12. User-global read-only detail ---------------------------------
  await win
    .locator("li", { hasText: "code-review-notes" })
    .first()
    .getByRole("button", { name: "打开" })
    .click();
  await win.getByText("SKILL.md 内容").waitFor({ timeout: 10_000 });
  await win.waitForTimeout(600);
  await shot(win, "readonly-detail-user-global", "用户全局技能只读详情");
  await win.getByRole("button", { name: "返回技能列表" }).click();
  await win.waitForTimeout(400);

  // --- 13. Add-skill menu (screenshot only) ------------------------------
  await win.getByRole("button", { name: "添加技能" }).click();
  await win.waitForTimeout(300);
  await shot(win, "add-menu", "添加技能下拉（从文件夹导入 / 新建空白技能）");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // --- 14. Filters & search ----------------------------------------------
  await win
    .getByRole("tab", { name: "用户全局" })
    .click()
    .catch(() => win.getByText("用户全局", { exact: true }).first().click());
  await win.waitForTimeout(300);
  await shot(win, "filter-user-global", "来源筛选：用户全局");
  await win.getByText("全部", { exact: true }).first().click();
  await win.getByPlaceholder(/搜索技能/).fill("zzz-no-match");
  await win.waitForTimeout(300);
  await shot(win, "search-no-results", "搜索无结果空态");
  await win.getByRole("button", { name: /清除搜索和筛选|清除筛选/ }).click();
  await win.waitForTimeout(300);

  // --- 15. Empty project detail ------------------------------------------
  await win.getByRole("button", { name: "返回项目列表" }).click();
  await win.waitForTimeout(400);
  await win.getByText("project-empty", { exact: true }).first().click();
  await win.waitForTimeout(1200);
  await shot(win, "empty-project-detail", "空项目详情（空态 + 导入入口）");

  await app.close();

  writeFileSync(
    join(BASE, "manifest.json"),
    JSON.stringify({ manifest, consoleErrors }, null, 2)
  );
  process.stdout.write(
    `\nDONE shots=${manifest.length} consoleErrors=${consoleErrors.length}\n`
  );
}

main().catch((error) => {
  writeFileSync(
    join(BASE, "manifest.json"),
    JSON.stringify({ manifest, consoleErrors, error: String(error) }, null, 2)
  );
  console.error("WALKTHROUGH FAILED:", error);
  process.exit(1);
});
