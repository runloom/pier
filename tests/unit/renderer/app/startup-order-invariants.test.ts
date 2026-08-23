// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  join(process.cwd(), "src/renderer/main.tsx"),
  "utf8"
);
const bootSource = readFileSync(
  join(process.cwd(), "src/renderer/app/boot-signal.tsx"),
  "utf8"
);
const startSource = readFileSync(
  join(process.cwd(), "src/renderer/app/start-application.tsx"),
  "utf8"
);
const source = `${mainSource}\n${startSource}`;

describe("renderer startup ordering", () => {
  it("does not statically import the application graph before the startup shell", () => {
    expect(mainSource).not.toMatch(/from ["']\.\/App\.tsx["']/);
    expect(mainSource).not.toContain("bootstrapBuiltinPlugins");
    expect(mainSource).toContain('import("./app/start-application.tsx")');
  });

  it("renders a startup state before asynchronous core initialization", () => {
    expect(mainSource.indexOf("<StartupScreen />")).toBeGreaterThan(-1);
    expect(source.indexOf("<StartupScreen />")).toBeLessThan(
      source.indexOf("await initI18n()")
    );
    expect(source.indexOf("<AppDialogHost />")).toBeLessThan(
      source.indexOf("await initI18n()")
    );
  });

  // 启动壳先于 i18next 渲染：html lang 必须在首帧前解析为系统语言，
  // 否则 StartupScreen 等启动期文案只会读到 index.html 的默认 lang="en"。
  it("resolves the document language from the system locale before painting the startup shell", () => {
    const langSync = mainSource.indexOf(
      'document.documentElement.lang = resolveLanguagePreference("system")'
    );
    expect(langSync).toBeGreaterThan(-1);
    // 必须是 bootstrap() 第一条语句：先于一切可抛错调用，
    // 这样 .catch 兜底的 StartupErrorScreen 也能读到正确语言。
    expect(mainSource.indexOf("installBundledFontFaces()")).toBeGreaterThan(
      langSync
    );
    expect(mainSource.indexOf("root.render(")).toBeGreaterThan(langSync);
  });

  it("installs the renderer command listener before the first startup await", () => {
    expect(
      startSource.indexOf("installWorkspaceRendererCommandListener()")
    ).toBeGreaterThan(-1);
    expect(
      startSource.indexOf("installWorkspaceRendererCommandListener()")
    ).toBeLessThan(startSource.indexOf("await initI18n()"));
  });

  it("renders App before starting external plugins", () => {
    const appRender = startSource.indexOf("<App />");
    expect(appRender).toBeGreaterThan(-1);
    expect(appRender).toBeLessThan(
      startSource.indexOf("pluginBootstrap.startExternal()")
    );
    expect(startSource.indexOf("requestAnimationFrame(() =>")).toBeLessThan(
      startSource.indexOf("pluginBootstrap.startExternal()")
    );
  });

  it("keeps the application tree inside the runtime recovery boundary", () => {
    expect(startSource).toMatch(
      /<AppRuntimeErrorBoundary>\s*<App \/>\s*<\/AppRuntimeErrorBoundary>/
    );
  });

  it("renders a visible fatal state when bootstrap rejects", () => {
    expect(bootSource).toContain("window.pier?.window?.readyToShow?.()");
    expect(mainSource).toContain("<StartupErrorScreen error={err} />");
    expect(mainSource).toMatch(
      /<RendererBootSignal key="startup-error" \/>\s*<StartupErrorScreen error=\{err\} \/>/
    );
  });

  // 仅有 contribution 导出不够：快捷键 / 命令面板依赖 actionRegistry。
  // 漏掉 bootstrap 注册会静默 no-op（历史事故：pier.notifications.open）。
  it("registers notification-center actions during bootstrap", () => {
    expect(startSource).toContain("notification-center-actions.ts");
    expect(startSource).toContain("registerNotificationCenterActions()");
  });
});
