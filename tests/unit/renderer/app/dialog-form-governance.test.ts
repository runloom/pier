import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;

const PRODUCTION_SOURCE_ROOTS = [
  join(ROOT, "src", "renderer"),
  join(ROOT, "src", "plugins", "builtin"),
  join(ROOT, "packages", "plugin-codex"),
  join(ROOT, "packages", "plugin-claude"),
  join(ROOT, "packages", "plugin-grok"),
  join(ROOT, "packages", "plugin-ssh"),
  join(ROOT, "packages", "plugin-agent-splits"),
];

/** Content-dialog commit forms that must use setFooter (not body fake-footer). */
const COMMIT_FORM_DIALOG_FILES = [
  "src/plugins/builtin/git/renderer/worktree/create-overlay.tsx",
  "src/plugins/builtin/git/renderer/commit/overlay.tsx",
  "src/renderer/pages/settings/components/skills/create-dialog.tsx",
  "src/renderer/pages/settings/components/pier-home-create-skill-dialog.tsx",
  "packages/plugin-ssh/src/renderer/host-form-dialog.tsx",
  "packages/plugin-ssh/src/renderer/import-hosts-dialog.tsx",
  "packages/plugin-codex/src/renderer/switch-confirm-dialog.tsx",
  "packages/plugin-codex/src/renderer/add-account-dialog.tsx",
  "packages/plugin-codex/src/renderer/add-account-waiting.tsx",
  "packages/plugin-grok/src/renderer/switch-confirm-dialog.tsx",
  "packages/plugin-grok/src/renderer/add-account-content.tsx",
  "packages/plugin-claude/src/renderer/add-account-content.tsx",
] as const;

/** Body fake-footer: cancel/primary cluster that should live in setFooter. */
const BODY_FAKE_FOOTER_RE =
  /className=\{?["'`][^"'`]*justify-end[^"'`]*["'`]\}?[\s\S]{0,240}variant=["']outline["']/;

function walkSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) files.push(full);
  }
  return files;
}

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath);
}

describe("dialog form governance", () => {
  it("documents commit vs live preference models in AGENTS.md", () => {
    const agents = source("AGENTS.md");
    expect(agents).toContain("#### 弹窗表单规范");
    expect(agents).toContain("提交型（commit form）");
    expect(agents).toContain("即时偏好（live preference）");
    expect(agents).toContain("dialog-form-layout.ts");
    expect(agents).toContain("禁止 body 内仿 footer");
    expect(agents).toContain("提交型 dialog 的可选勾选");
    expect(agents).toContain("禁止第三套「记住上次」");
    expect(agents).toContain("情境决策");
    expect(agents).toContain("稳定工作流习惯");
    expect(agents).toContain(
      "tests/unit/renderer/app/dialog-form-governance.test.ts"
    );
  });

  it("keeps shared dialog form layout tokens in packages/ui", () => {
    const layout = source("packages/ui/src/dialog-form-layout.ts");
    expect(layout).toContain("DIALOG_COMMIT_FORM_CLASS");
    expect(layout).toContain("DIALOG_COMMIT_FIELD_GROUP_CLASS");
    expect(layout).toContain("DIALOG_PREFERENCE_FORM_CLASS");
    expect(layout).toContain("DIALOG_PREFERENCE_FIELD_GROUP_CLASS");
    expect(layout).toContain("DIALOG_FOOTER_ACTIONS_CLASS");
    expect(layout).toContain("DIALOG_SECTION_TITLE_CLASS");
    const pkg = source("packages/ui/package.json");
    expect(pkg).toContain('"./dialog-form-layout.ts"');
    expect(pkg).toContain("./src/dialog-form-layout.ts");
  });

  it("keeps AppContentDialogHost sticky footer chrome", () => {
    const host = source(
      "src/renderer/components/common/dialogs/content-host.tsx"
    );
    expect(host).toContain("setFooter");
    expect(host).toContain("DialogFooter");
    expect(host).toContain("px-6 py-5");
    expect(host).toContain("px-6 py-4");
  });

  it("keeps content-dialog body as a native flex scroller (skill SKILL.md)", () => {
    const host = source(
      "src/renderer/components/common/dialogs/content-host.tsx"
    );
    // Header/footer sticky; body is the only vertical overflow owner.
    // Native overflow (not Radix ScrollArea): auto-height CodeMirror skill
    // bodies exceed max-h; ScrollArea display:table + flex max-h often clips
    // without scrolling (see skill open dialogs).
    expect(host).toContain('data-slot="app-content-dialog-body"');
    expect(host).toContain("overflow-y-auto");
    expect(host).toContain("min-h-0");
    expect(host).toContain("flex-1");
    expect(host).toContain("max-h-[min(calc(90vh-2rem),880px)]");
    expect(host).toContain("scrollFadeClassName");
    expect(host).toContain('data-scrollbar="overlay"');
    // Fade helper may still import from scroll-area; body must not be ScrollArea.
    expect(host).not.toMatch(/<ScrollArea\b/);
    expect(host).not.toContain("viewportFade");
  });

  it("requires skill content-dialog MarkdownSourceEditor to use autoHeight", () => {
    // Parent dialog body owns scroll; nested CM overflow traps wheel otherwise.
    const skillDialogSources = [
      "src/renderer/pages/settings/components/skills/content-body.tsx",
      "src/renderer/pages/settings/components/skills/detail-content.tsx",
      "src/renderer/pages/settings/components/skills/create-dialog.tsx",
      "src/renderer/pages/settings/components/pier-home-skill-detail.tsx",
      "src/renderer/pages/settings/components/pier-home-create-skill-dialog.tsx",
    ] as const;
    for (const file of skillDialogSources) {
      const text = source(file);
      expect(text, file).toContain("MarkdownSourceEditor");
      expect(text, `${file} missing autoHeight`).toMatch(
        /<MarkdownSourceEditor[\s\S]*?\bautoHeight\b/
      );
    }
  });

  it("requires commit-form dialogs to set sticky footer", () => {
    const missing: string[] = [];
    for (const file of COMMIT_FORM_DIALOG_FILES) {
      const text = source(file);
      if (!text.includes("setFooter")) {
        missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });

  it("forbids body fake-footer clusters in commit-form dialog files", () => {
    const offenders: string[] = [];
    for (const file of COMMIT_FORM_DIALOG_FILES) {
      const text = source(file);
      // Sticky footer construction uses DIALOG_FOOTER_ACTIONS_CLASS — allowed.
      // Body clusters with justify-end + outline cancel are not.
      const withoutFooterToken = text
        .split("DIALOG_FOOTER_ACTIONS_CLASS")
        .join("/*footer*/");
      if (BODY_FAKE_FOOTER_RE.test(withoutFooterToken)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps worktree create as the commit-form reference implementation", () => {
    const worktree = source(
      "src/plugins/builtin/git/renderer/worktree/create-overlay.tsx"
    );
    expect(worktree).toContain("DIALOG_COMMIT_FORM_CLASS");
    expect(worktree).toContain("DIALOG_COMMIT_FIELD_GROUP_CLASS");
    expect(worktree).toContain("DIALOG_FOOTER_ACTIONS_CLASS");
    expect(worktree).toContain('data-slot="dialog-commit-form"');
    expect(worktree).toContain("setFooter");
  });

  it("keeps git commit confirm overlay on the commit-form path", () => {
    const overlay = source(
      "src/plugins/builtin/git/renderer/commit/overlay.tsx"
    );
    expect(overlay).toContain("DIALOG_COMMIT_FORM_CLASS");
    expect(overlay).toContain("DIALOG_COMMIT_FIELD_GROUP_CLASS");
    expect(overlay).toContain("DIALOG_FOOTER_ACTIONS_CLASS");
    expect(overlay).toContain('data-slot="dialog-commit-form"');
    expect(overlay).toContain("setFooter");
  });

  it("derives git commit checkboxes from the current snapshot and does not remember last choice", () => {
    const overlay = source(
      "src/plugins/builtin/git/renderer/commit/overlay.tsx"
    );
    const spec = source(
      "docs/superpowers/specs/2026-08-29-git-commit-confirm-design.md"
    );
    expect(overlay).toContain("GIT_COMMIT_PUSH_AFTER_SETTING_KEY");
    expect(overlay).toContain("useGitStatus");
    expect(overlay).toContain("isModEnterSubmit");
    expect(overlay).not.toMatch(/configuration\.set\(/);
    expect(overlay).not.toMatch(/localStorage/);
    expect(overlay).not.toMatch(/sessionStorage/);
    const defaults = source(
      "src/plugins/builtin/git/renderer/commit/defaults.ts"
    );
    expect(defaults).toContain("metaKey");
    expect(defaults).toContain("ctrlKey");
    expect(
      source("src/plugins/builtin/git/renderer/commit/submit.ts")
    ).toContain("getStatus");
    expect(
      source("src/plugins/builtin/git/renderer/commit/submit.ts")
    ).toContain("includeIntent");
    expect(
      source("src/plugins/builtin/git/renderer/commit/submit.ts")
    ).not.toMatch(/runRemoteSyncAction/);
    expect(
      source("src/plugins/builtin/git/renderer/commit/submit.ts")
    ).toContain("getInFlightSync");
    expect(
      source("src/plugins/builtin/git/renderer/commit/submit.ts")
    ).toContain("trackSync");
    expect(overlay).toContain("includeIntent");
    expect(overlay).toContain("lastLoadedRef");
    expect(
      source("src/plugins/builtin/git/renderer/commit/button.tsx")
    ).toContain("showError");
    expect(
      source("src/plugins/builtin/git/renderer/commit/button.tsx")
    ).not.toMatch(/runGitCommitCommand\(context\)\.catch\(\(\) => undefined\)/);
    expect(spec).toContain("金标准");
    expect(spec).toContain("不记忆");
    expect(spec).toContain("不回写");
    expect(spec).toContain("pier.git.commit.pushAfter");
    expect(spec).not.toContain("SHIP-FLOW v1");
    const en = source("src/plugins/builtin/git/locales/en.json");
    expect(en).toContain("Commit the current changes.");
    expect(en).not.toMatch(/Commit staged changes/);
    expect(source("src/plugins/builtin/git/locales/zh-CN.json")).toContain(
      "提交当前更改。"
    );
    expect(source("src/plugins/builtin/git/locales/zh-CN.json")).toContain(
      "确认提交"
    );
    expect(source("src/plugins/builtin/git/locales/zh-CN.json")).not.toContain(
      "提交已暂存的更改，可选"
    );
  });

  it("does not allow plugins to mount product Dialog shells for forms", () => {
    // Mirror plugin-product-dialog-governance: keep a second lock near form rules.
    const forbidden =
      /from\s+["']@pier\/ui\/(?:dialog|alert-dialog)(?:\.tsx)?["']/;
    const offenders: string[] = [];
    for (const root of [
      join(ROOT, "packages", "plugin-claude", "src", "renderer"),
      join(ROOT, "packages", "plugin-codex", "src", "renderer"),
      join(ROOT, "packages", "plugin-grok", "src", "renderer"),
      join(ROOT, "packages", "plugin-ssh", "src", "renderer"),
      join(ROOT, "packages", "plugin-agent-splits", "src", "renderer"),
      join(ROOT, "src", "plugins", "builtin"),
    ]) {
      for (const file of walkSourceFiles(root)) {
        if (forbidden.test(readFileSync(file, "utf8"))) {
          offenders.push(projectRelative(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("scans production sources for new rounded-xl nested form cards in *settings* dialog bodies", () => {
    // Widget settings and content dialog form files must not reintroduce nested
    // card chrome for field groups.
    const settingsLike = PRODUCTION_SOURCE_ROOTS.flatMap(walkSourceFiles)
      .map(projectRelative)
      .filter(
        (path) =>
          /settings|form-dialog|create-overlay|create-skill|host-form/i.test(
            path
          ) && !path.includes(".test.")
      );

    const offenders: string[] = [];
    for (const path of settingsLike) {
      const text = source(path);
      if (/rounded-xl\s+border[^"']*bg-muted/.test(text)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
