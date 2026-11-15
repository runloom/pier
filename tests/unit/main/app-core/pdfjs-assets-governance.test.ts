import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pdfjsAssetRootDir,
  resolvePdfjsAssetPath,
} from "@main/fonts/asset-paths.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

let devRuntime = true;

vi.mock("@main/runtime-mode.ts", () => ({
  isDevRuntime: () => devRuntime,
}));

beforeEach(() => {
  devRuntime = true;
});

describe("pdfjs asset paths", () => {
  it("resolves the dev asset root from node_modules", () => {
    expect(pdfjsAssetRootDir()).toBe(
      join(process.cwd(), "node_modules/pdfjs-dist")
    );
  });

  it("resolves the packaged asset root from resourcesPath", () => {
    devRuntime = false;
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/app/Resources",
    });
    expect(pdfjsAssetRootDir()).toBe("/app/Resources/pdfjs");
  });
});

describe("resolvePdfjsAssetPath", () => {
  const root = "/app/Resources/pdfjs";

  it("accepts known asset directories and extensions", () => {
    for (const relative of [
      "cmaps/Adobe-Japan1-UCS2.bcmap",
      "standard_fonts/FoxitSans.pfb",
      "standard_fonts/LiberationSans-Regular.ttf",
      "wasm/openjpeg.wasm",
    ]) {
      expect(resolvePdfjsAssetPath({ relative, root })).toBe(
        join(root, ...relative.split("/"))
      );
    }
  });

  it("rejects traversal, unknown directories and other extensions", () => {
    for (const relative of [
      "../secret.bcmap",
      "cmaps/../secret.bcmap",
      "cmaps/./secret.bcmap",
      "fonts/FoxitSans.pfb",
      "cmaps/app.js",
      "cmaps/secret.exe",
      "cmaps",
      "/etc/passwd.bcmap",
      "cmaps\\Adobe-Japan1-UCS2.bcmap",
      "cmaps/%2e%2e/secret.bcmap",
    ]) {
      expect(resolvePdfjsAssetPath({ relative, root })).toBeNull();
    }
  });
});

describe("electron-builder pdfjs extraResources", () => {
  it("copies cmaps, standard fonts and wasm", () => {
    const config = readFileSync(
      join(process.cwd(), "electron-builder.yml"),
      "utf8"
    );
    for (const target of [
      "to: pdfjs/cmaps",
      "to: pdfjs/standard_fonts",
      "to: pdfjs/wasm",
    ]) {
      expect(config).toContain(target);
    }
  });
});
