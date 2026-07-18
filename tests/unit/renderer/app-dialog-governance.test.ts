import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const PRODUCTION_SOURCE_ROOTS = [
  join(ROOT, "src", "renderer"),
  join(ROOT, "src", "plugins", "builtin"),
];
const ALLOWED_ALERT_DIALOG_IMPORTS = new Set([
  "src/renderer/components/common/app-dialog-host.tsx",
]);
const REQUIRED_APP_CONFIRM_OPTIONS_RE =
  /interface AppConfirmOptions[\s\S]*intent: AppDialogIntent;[\s\S]*size: AppDialogSize;/;
const REQUIRED_PLUGIN_CONFIRM_OPTIONS_RE =
  /confirm\(options: \{[\s\S]*intent: RendererPluginDialogIntent;[\s\S]*size: RendererPluginDialogSize;/;
const REQUIRED_APP_PROMPT_OPTIONS_RE =
  /interface AppPromptOptions[\s\S]*intent: AppDialogIntent;[\s\S]*size: AppDialogSize;/;
const REQUIRED_PLUGIN_PROMPT_OPTIONS_RE =
  /prompt\(options: \{[\s\S]*intent: RendererPluginDialogIntent;[\s\S]*size: RendererPluginDialogSize;/;

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
    expect(agentContext).toContain("sm`：仅两键短确认");
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
      join(
        ROOT,
        "src",
        "renderer",
        "components",
        "common",
        "app-dialog-host.tsx"
      ),
      "utf8"
    );

    expect(appDialogHost).toContain("currentDialog ?? retainedDialog");
    expect(appDialogHost).not.toContain("APP_DIALOG_EXIT_MS");
    expect(appDialogHost).not.toContain("setTimeout(");
  });

  it("requires every confirm dialog request to choose size and intent explicitly", () => {
    const appDialogStore = readFileSync(
      join(ROOT, "src", "renderer", "stores", "app-dialog.store.ts"),
      "utf8"
    );
    const pluginDialogsApi = readFileSync(
      join(ROOT, "src", "plugins", "api", "renderer-dialogs.ts"),
      "utf8"
    );

    expect(appDialogStore).toMatch(REQUIRED_APP_CONFIRM_OPTIONS_RE);
    expect(pluginDialogsApi).toMatch(REQUIRED_PLUGIN_CONFIRM_OPTIONS_RE);
  });

  it("requires prompt dialog request to declare size + intent explicitly", () => {
    const appDialogStore = readFileSync(
      join(ROOT, "src", "renderer", "stores", "app-dialog.store.ts"),
      "utf8"
    );
    const pluginDialogsApi = readFileSync(
      join(ROOT, "src", "plugins", "api", "renderer-dialogs.ts"),
      "utf8"
    );

    // 与 confirm 对齐:size 与 intent 强制,避免 prompt 无声继承 default 尺寸
    // 导致长内容溢出、或误用 destructive 语义。
    expect(appDialogStore).toMatch(REQUIRED_APP_PROMPT_OPTIONS_RE);
    expect(pluginDialogsApi).toMatch(REQUIRED_PLUGIN_PROMPT_OPTIONS_RE);
  });

  it("keeps choice dialogs on default width in production sources", () => {
    const choiceCallRe =
      /(?:showAppChoice|dialogs\.choice)\(\s*\{([\s\S]*?)\}\s*\)/g;
    const offenders = PRODUCTION_SOURCE_ROOTS.flatMap(sourceFiles).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, "utf8");
        const hits: string[] = [];
        for (const match of source.matchAll(choiceCallRe)) {
          const body = match[1] ?? "";
          if (/size:\s*"sm"/.test(body)) {
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
      join(
        ROOT,
        "src",
        "renderer",
        "components",
        "common",
        "app-dialog-host.tsx"
      ),
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
    expect(alertDialog).not.toContain("grid-cols-2");
    expect(alertDialog).not.toContain("place-items-center");
    expect(alertDialog).not.toContain("size-16");
  });

  it("uses shared StatusIcon for destructive confirm danger mark", () => {
    const appDialogHost = readFileSync(
      join(
        ROOT,
        "src",
        "renderer",
        "components",
        "common",
        "app-dialog-host.tsx"
      ),
      "utf8"
    );

    expect(appDialogHost).toContain("@pier/ui/status-icon");
    expect(appDialogHost).toContain('kind="error"');
    expect(appDialogHost).toContain("items-center");
    expect(appDialogHost).not.toContain("TriangleAlertIcon");
    expect(appDialogHost).not.toContain("AlertDialogMedia");
  });
});
