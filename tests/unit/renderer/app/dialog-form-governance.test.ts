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
  "src/renderer/panel-kits/workbench/core-widgets/custom-card/add-block-dialog.tsx",
] as const;

const WIDGET_SETTINGS_FILES = [
  "src/renderer/panel-kits/workbench/core-widgets/cost/overview-settings.tsx",
  "src/renderer/panel-kits/workbench/core-widgets/custom-card/settings.tsx",
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
    expect(agents).toContain("WorkbenchSettingsDialog");
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

  it("keeps WorkbenchSettingsDialog as live-preference shell with optional sticky footer", () => {
    const dialog = source(
      "src/renderer/panel-kits/workbench/settings-dialog.tsx"
    );
    expect(dialog).toContain("workbench-widget-settings-dialog");
    expect(dialog).toContain("settingsComponent");
    expect(dialog).toContain("px-6 py-4");
    expect(dialog).toContain("px-6 py-5");
    // Optional sticky footer via setFooter (same chrome as content dialog).
    expect(dialog).toContain("DialogFooter");
    expect(dialog).toContain("setFooter");
    expect(dialog).toContain('data-testid="workbench-widget-settings-footer"');
    expect(dialog).toContain("即时偏好");
    // Clear footer only when dialog fully closes (widget falsy), not on
    // instance-id layout race after child registration.
    expect(dialog).not.toContain("settingsInstanceId");
    expect(dialog).toContain("setFooterState(null)");
    expect(dialog).toMatch(/if\s*\(\s*widget\s*\)/);
  });

  it("keeps workbench settings body as a native flex scroller (max-h shell)", () => {
    const dialog = source(
      "src/renderer/panel-kits/workbench/settings-dialog.tsx"
    );
    // Same bug class as content dialog: flex max-h + ScrollArea clips tall
    // settings (custom-card block lists). Body owns native overflow-y-auto.
    expect(dialog).toContain('data-slot="workbench-widget-settings-body"');
    expect(dialog).toContain("overflow-y-auto");
    expect(dialog).toContain("min-h-0");
    expect(dialog).toContain("flex-1");
    expect(dialog).toContain(
      "max-h-[min(36rem,calc(100vh-var(--app-titlebar-height)-2rem))]"
    );
    expect(dialog).toContain("scrollFadeClassName");
    expect(dialog).toContain('data-scrollbar="overlay"');
    expect(dialog).not.toMatch(/<ScrollArea\b/);
    expect(dialog).not.toContain("viewportFade");
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

  it("aligns widget settings to dialog commit-form field layout (vertical, full-width)", () => {
    for (const file of WIDGET_SETTINGS_FILES) {
      const text = source(file);
      expect(text).toContain("@pier/ui/dialog-form-layout.ts");
      expect(text).toContain("DIALOG_COMMIT_FORM_CLASS");
      expect(text).toContain("workbench-live-preference-form");
      // Default 28px Select — no size="sm" on primary form triggers.
      expect(text).not.toMatch(/SelectTrigger[^>]*size=["']sm["']/);
      // No nested rounded-xl form cards (Dialog shell is enough).
      // Multi-instance lists may use Item outline, not Card / rounded-xl shells.
      expect(text).not.toMatch(/rounded-xl\s+border/);
      expect(text).not.toMatch(/from\s+["']@pier\/ui\/card/);
      // Primary scalar fields must not use settings-page horizontal rows
      // (left label + narrow right control). Checkbox list rows may stay horizontal.
      expect(text).not.toMatch(
        /FieldContent[\s\S]{0,200}SelectTrigger[\s\S]{0,80}w-\[11/
      );
    }
    const cost = source(WIDGET_SETTINGS_FILES[0]);
    expect(cost).toContain("DIALOG_COMMIT_FIELD_GROUP_CLASS");

    const customCard = source(WIDGET_SETTINGS_FILES[1]);
    expect(customCard).toContain("ItemGroup");
    expect(customCard).toContain("DIALOG_FOOTER_ACTIONS_CLASS");
    expect(customCard).toContain("useContentDialogFooter");
    expect(customCard).toContain("setFooter");
    expect(customCard).toContain("openAddBlockDialog");
    const customCardAdd = source(
      "src/renderer/panel-kits/workbench/core-widgets/custom-card/add-block-dialog.tsx"
    );
    expect(customCardAdd).toContain("openAppContentDialog");
    expect(customCardAdd).toContain("DIALOG_COMMIT_FIELD_GROUP_CLASS");
    expect(customCardAdd).toContain("DIALOG_FOOTER_ACTIONS_CLASS");
    const customCardEditor = source(
      "src/renderer/panel-kits/workbench/core-widgets/custom-card/block-editor.tsx"
    );
    expect(customCardEditor).toContain('variant="outline"');
    expect(customCardEditor).toContain("DIALOG_COMMIT_FIELD_GROUP_CLASS");
    const settingsHost = source(
      "src/renderer/panel-kits/workbench/settings-dialog.tsx"
    );
    expect(settingsHost).toContain("DialogFooter");
    expect(settingsHost).toContain("setFooter");
    expect(settingsHost).toContain(
      'data-testid="workbench-widget-settings-footer"'
    );
    // Primary Select is full width under vertical label; range chips stay content-sized.
    expect(cost).toMatch(/SelectTrigger[\s\S]{0,80}w-full/);
    expect(cost).toContain("w-fit max-w-full");
    expect(cost).not.toMatch(/ToggleGroupItem[\s\S]{0,40}flex-1/);
    // Source checkboxes wrap horizontally (not a tall single-column list).
    expect(cost).toContain("flex-row flex-wrap");
    // Must not reintroduce left-label / right-control primary rows for view.
    expect(cost).not.toMatch(
      /orientation=["']horizontal["'][\s\S]{0,120}cost-overview-preset/
    );
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
