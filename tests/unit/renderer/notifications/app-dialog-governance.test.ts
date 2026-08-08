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
];
const ALLOWED_ALERT_DIALOG_IMPORTS = new Set([
  "src/renderer/components/common/dialogs/host.tsx",
]);

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(filePath));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath);
}

describe("app dialog usage governance", () => {
  it("documents the host dialog usage policy in project agent context", () => {
    const agentContext = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

    expect(agentContext).toContain("### 宿主弹窗使用规范");
    expect(agentContext).toContain("桌面工具对话框");
    expect(agentContext).toContain("**`size` 禁止调用方传入**");
    expect(agentContext).toContain(
      "`alert` / `confirm` / `prompt` → 固定 `sm`"
    );
    expect(agentContext).toContain("`choice` → 固定 `default`");
    expect(agentContext).toContain("`choice`：`alt | 取消 | confirm`");
    expect(agentContext).toContain(
      '破坏性确认必须显式传 `intent: "destructive"`'
    );
    expect(agentContext).toContain(
      '若破坏动作落在 `choice.confirm`（如覆盖），`intent` 仍必须 `"default"`'
    );
    expect(agentContext).toContain(
      "builtin 与 external 插件的简单弹窗 API **同构**"
    );
    expect(agentContext).toContain("禁止回退为「每个确认各自传 sm/default」");
  });

  it("keeps shadcn AlertDialog primitive behind AppDialogHost", () => {
    const offenders = PRODUCTION_SOURCE_ROOTS.flatMap(sourceFiles)
      .filter((filePath) =>
        readFileSync(filePath, "utf8").includes("@pier/ui/alert-dialog")
      )
      .map(projectRelative)
      .filter((filePath) => !ALLOWED_ALERT_DIALOG_IMPORTS.has(filePath));

    expect(offenders).toEqual([]);
  });

  it("keeps dialog results independent from presentation timing", () => {
    const appDialogHost = readFileSync(
      join(ROOT, "src", "renderer", "components", "common", "dialogs/host.tsx"),
      "utf8"
    );

    expect(appDialogHost).toContain("currentDialog ?? retainedDialog");
    expect(appDialogHost).not.toContain("APP_DIALOG_EXIT_MS");
    expect(appDialogHost).not.toContain("setTimeout(");
  });

  it("owns size by kind in the store (callers cannot pass size)", () => {
    const appDialogStore = readFileSync(
      join(ROOT, "src", "renderer", "stores", "app-dialog.store.ts"),
      "utf8"
    );
    const pluginDialogsApi = readFileSync(
      join(ROOT, "src", "plugins", "api", "renderer-dialogs.ts"),
      "utf8"
    );
    const externalPluginApi = readFileSync(
      join(ROOT, "packages", "plugin-api", "src", "renderer.ts"),
      "utf8"
    );

    expect(appDialogStore).toContain("export function appDialogSizeForKind");
    expect(appDialogStore).toContain(
      'return kind === "choice" ? "default" : "sm"'
    );
    expect(appDialogStore).toContain("禁止调用方传入");
    // Public option types must not declare size (internal request may keep it).
    for (const name of [
      "AppAlertOptions",
      "AppConfirmOptions",
      "AppChoiceOptions",
      "AppPromptOptions",
    ]) {
      const block = appDialogStore.match(
        new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`, "m")
      )?.[1];
      expect(block, name).toBeDefined();
      expect(block, name).not.toMatch(/\bsize\s*:/);
    }
    // Public open helpers must not read options.size.
    expect(appDialogStore).not.toContain("options.size");
    expect(appDialogStore).not.toContain("(options as AppConfirmOptions).size");

    expect(pluginDialogsApi).not.toContain("size: RendererPluginDialogSize");
    expect(pluginDialogsApi).not.toContain(
      "export type RendererPluginDialogSize"
    );
    expect(pluginDialogsApi).toContain("size 不由插件传入");
    expect(externalPluginApi).not.toContain("size: RendererPluginDialogSize");
    expect(externalPluginApi).not.toContain(
      "export type RendererPluginDialogSize"
    );
  });

  it("forbids size: in production simple-dialog call sites", () => {
    const callRe =
      /(?:showAppConfirm|showAppChoice|showAppPrompt|dialogs\.confirm|dialogs\.choice|dialogs\.prompt)\(\s*\{([\s\S]*?)\}\s*\)/g;
    const offenders = PRODUCTION_SOURCE_ROOTS.flatMap(sourceFiles).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, "utf8");
        const hits: string[] = [];
        for (const match of source.matchAll(callRe)) {
          const body = match[1] ?? "";
          if (/\bsize\s*:/.test(body)) {
            hits.push(projectRelative(filePath));
          }
        }
        return hits;
      }
    );

    expect(offenders).toEqual([]);
  });

  it("renders choice dialogs with macOS button order and default width", () => {
    const appDialogHost = readFileSync(
      join(ROOT, "src", "renderer", "components", "common", "dialogs/host.tsx"),
      "utf8"
    );

    expect(appDialogHost).toContain('size="default"');
    expect(appDialogHost).toContain('dialog.resolve("alt")');
    expect(appDialogHost).toContain('dialog.resolve("cancel")');
    expect(appDialogHost).toContain('dialog.resolve("confirm")');
    expect(appDialogHost).not.toContain("flex-col-reverse!");
  });

  it("keeps alert-dialog primitive on desktop tool density", () => {
    const alertDialog = readFileSync(
      join(ROOT, "packages", "ui", "src", "alert-dialog.tsx"),
      "utf8"
    );

    expect(alertDialog).toContain("text-left");
    expect(alertDialog).toContain("sm:justify-end");
    expect(alertDialog).toContain("gap-4");
    expect(alertDialog).toContain("p-5");
    expect(alertDialog).toContain("text-base");
    // choice(default) stays slightly wider than confirm/alert(sm) for 3
    // buttons, but converges to max-w-sm — not max-w-md — so the shell family
    // feels one size step apart rather than a different card.
    expect(alertDialog).toContain("data-[size=sm]:max-w-xs");
    expect(alertDialog).toContain("data-[size=default]:sm:max-w-sm");
    expect(alertDialog).not.toContain("data-[size=default]:sm:max-w-md");
    expect(alertDialog).not.toContain("grid-cols-2");
    expect(alertDialog).not.toContain("place-items-center");
    expect(alertDialog).not.toContain("size-16");
  });

  it("uses shared StatusIcon for destructive confirm danger mark", () => {
    const appDialogHost = readFileSync(
      join(ROOT, "src", "renderer", "components", "common", "dialogs/host.tsx"),
      "utf8"
    );

    expect(appDialogHost).toContain("@pier/ui/status-icon");
    expect(appDialogHost).toContain('kind="error"');
    expect(appDialogHost).toContain("items-center");
    expect(appDialogHost).not.toContain("TriangleAlertIcon");
    expect(appDialogHost).not.toContain("AlertDialogMedia");
  });

  it("keeps long alert body scrollbar flush to the dialog content edge", () => {
    const appDialogHost = readFileSync(
      join(ROOT, "src", "renderer", "components", "common", "dialogs/host.tsx"),
      "utf8"
    );

    // Content shell is p-5; body scroller bleeds with -mx-5 and re-applies px-5
    // so the thumb sits on the card edge while copy stays aligned with title.
    expect(appDialogHost).toContain("overflow-y-auto");
    expect(appDialogHost).toContain("-mx-5");
    expect(appDialogHost).toContain("px-5");
    expect(appDialogHost).toContain('data-scrollbar="overlay"');
  });
});
