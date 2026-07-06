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
    expect(agentContext).toContain('短确认弹窗必须显式传 `size: "sm"`');
    expect(agentContext).toContain(
      '破坏性确认必须显式传 `intent: "destructive"`'
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

  it("requires every confirm dialog request to choose size and intent explicitly", () => {
    const appDialogStore = readFileSync(
      join(ROOT, "src", "renderer", "stores", "app-dialog.store.ts"),
      "utf8"
    );
    const pluginRendererApi = readFileSync(
      join(ROOT, "src", "plugins", "api", "renderer.ts"),
      "utf8"
    );

    expect(appDialogStore).toMatch(REQUIRED_APP_CONFIRM_OPTIONS_RE);
    expect(pluginRendererApi).toMatch(REQUIRED_PLUGIN_CONFIRM_OPTIONS_RE);
  });
});
