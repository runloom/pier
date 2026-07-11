// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "../../../src/renderer/main.tsx"),
  "utf8"
);

describe("renderer startup ordering", () => {
  it("renders a startup state before asynchronous core initialization", () => {
    expect(source.indexOf("<StartupScreen />")).toBeGreaterThan(-1);
    expect(source.indexOf("<StartupScreen />")).toBeLessThan(
      source.indexOf("await initI18n()")
    );
    expect(source.indexOf("<AppDialogHost />")).toBeLessThan(
      source.indexOf("await initI18n()")
    );
  });

  it("installs the renderer command listener before the first startup await", () => {
    expect(
      source.indexOf("installWorkspaceRendererCommandListener()")
    ).toBeGreaterThan(-1);
    expect(
      source.indexOf("installWorkspaceRendererCommandListener()")
    ).toBeLessThan(source.indexOf("await initI18n()"));
  });

  it("renders App before starting external plugins", () => {
    expect(source.indexOf("root.render(<App />)")).toBeGreaterThan(-1);
    expect(source.indexOf("root.render(<App />)")).toBeLessThan(
      source.indexOf("pluginBootstrap.startExternal()")
    );
    expect(source.indexOf("requestAnimationFrame(() =>")).toBeLessThan(
      source.indexOf("pluginBootstrap.startExternal()")
    );
  });

  it("renders a visible fatal state when bootstrap rejects", () => {
    expect(source).toContain("<StartupErrorScreen error={err} />");
    expect(source).toContain("window.pier?.window?.readyToShow?.()");
  });
});
