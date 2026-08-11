import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCssImportOnDisk } from "../../../src/main/services/lsp/css-import-resolve-fs.ts";
import { cssImportAtOffset } from "../../../src/shared/css-import-at-position.ts";
import {
  type CssImportFs,
  resolveCssImportPath,
} from "../../../src/shared/css-import-resolve.ts";

function memoryFs(files: Record<string, string | "dir">): CssImportFs {
  const normalized = new Map(
    Object.entries(files).map(([key, value]) => [
      key.replace(/\\/g, "/"),
      value,
    ])
  );
  return {
    exists(path) {
      const key = path.replace(/\\/g, "/");
      if (normalized.has(key)) {
        return true;
      }
      // Directory exists if any file is nested under it.
      const prefix = key.endsWith("/") ? key : `${key}/`;
      for (const candidate of normalized.keys()) {
        if (candidate.startsWith(prefix) || candidate === key) {
          return true;
        }
      }
      return false;
    },
    isDirectory(path) {
      const key = path.replace(/\\/g, "/");
      if (normalized.get(key) === "dir") {
        return true;
      }
      const prefix = key.endsWith("/") ? key : `${key}/`;
      for (const [candidate, value] of normalized) {
        if (candidate.startsWith(prefix) && value !== "dir") {
          return true;
        }
        if (candidate === key && value === "dir") {
          return true;
        }
      }
      return false;
    },
    listDir(path) {
      const key = path.replace(/\\/g, "/").replace(/\/+$/u, "");
      const prefix = `${key}/`;
      const children = new Set<string>();
      for (const candidate of normalized.keys()) {
        if (!candidate.startsWith(prefix)) {
          continue;
        }
        const rest = candidate.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment) {
          children.add(segment);
        }
      }
      return [...children];
    },
    readJson(path) {
      const value = normalized.get(path.replace(/\\/g, "/"));
      if (typeof value !== "string") {
        return null;
      }
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return null;
      }
    },
  };
}

describe("cssImportAtOffset", () => {
  const sample = `@import "tailwindcss";
@import 'tw-animate-css';
@import "@pier/ui/tailwind-theme.css";
`;

  it("finds bare package import under cursor", () => {
    const offset = sample.indexOf("tailwindcss") + 3;
    const hit = cssImportAtOffset(sample, offset);
    expect(hit?.specifier).toBe("tailwindcss");
    expect(hit?.kind).toBe("import");
  });

  it("finds scoped package subpath", () => {
    const offset = sample.indexOf("@pier/ui");
    const hit = cssImportAtOffset(sample, offset);
    expect(hit?.specifier).toBe("@pier/ui/tailwind-theme.css");
  });
});

describe("resolveCssImportPath", () => {
  it("resolves package style export (tailwindcss-like)", () => {
    const fs = memoryFs({
      "/repo/src/app/globals.css": "/* */",
      "/repo/node_modules/tailwindcss": "dir",
      "/repo/node_modules/tailwindcss/package.json": JSON.stringify({
        name: "tailwindcss",
        exports: {
          ".": {
            style: "./index.css",
            import: "./dist/lib.mjs",
          },
        },
        style: "index.css",
      }),
      "/repo/node_modules/tailwindcss/index.css": "/* tw */",
    });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/src/app/globals.css",
        fs,
        specifier: "tailwindcss",
      })
    ).toEqual({
      isDirectory: false,
      path: "/repo/node_modules/tailwindcss/index.css",
    });
  });

  it("resolves style-only exports (tw-animate-css)", () => {
    const fs = memoryFs({
      "/repo/src/app/globals.css": "/* */",
      "/repo/node_modules/tw-animate-css": "dir",
      "/repo/node_modules/tw-animate-css/package.json": JSON.stringify({
        name: "tw-animate-css",
        exports: {
          ".": { style: "./dist/tw-animate.css" },
        },
      }),
      "/repo/node_modules/tw-animate-css/dist/tw-animate.css": "/* a */",
    });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/src/app/globals.css",
        fs,
        specifier: "tw-animate-css",
      })
    ).toEqual({
      isDirectory: false,
      path: "/repo/node_modules/tw-animate-css/dist/tw-animate.css",
    });
  });

  it("resolves package subpath export (shadcn/tailwind.css)", () => {
    const fs = memoryFs({
      "/repo/src/app/globals.css": "/* */",
      "/repo/node_modules/shadcn": "dir",
      "/repo/node_modules/shadcn/package.json": JSON.stringify({
        name: "shadcn",
        exports: {
          "./tailwind.css": "./dist/tailwind.css",
        },
      }),
      "/repo/node_modules/shadcn/dist/tailwind.css": "/* s */",
    });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/src/app/globals.css",
        fs,
        specifier: "shadcn/tailwind.css",
      })
    ).toEqual({
      isDirectory: false,
      path: "/repo/node_modules/shadcn/dist/tailwind.css",
    });
  });

  it("resolves workspace package @pier/ui", () => {
    const fs = memoryFs({
      "/repo/src/app/globals.css": "/* */",
      "/repo/node_modules/@pier/ui": "dir",
      "/repo/node_modules/@pier/ui/package.json": JSON.stringify({
        name: "@pier/ui",
        exports: {
          "./tailwind-theme.css": "./src/tailwind-theme.css",
        },
      }),
      "/repo/node_modules/@pier/ui/src/tailwind-theme.css": "/* theme */",
    });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/src/app/globals.css",
        fs,
        specifier: "@pier/ui/tailwind-theme.css",
      })
    ).toEqual({
      isDirectory: false,
      path: "/repo/node_modules/@pier/ui/src/tailwind-theme.css",
    });
  });

  it("resolves nested dependency from nearest node_modules", () => {
    const fs = memoryFs({
      "/repo/src/app/globals.css": "/* */",
      "/repo/packages/ui/node_modules/@xyflow/react": "dir",
      "/repo/packages/ui/node_modules/@xyflow/react/package.json":
        JSON.stringify({ name: "@xyflow/react" }),
      "/repo/packages/ui/node_modules/@xyflow/react/dist/style.css": "/* x */",
      // from a file under packages/ui
      "/repo/packages/ui/src/theme.css": "/* */",
    });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/packages/ui/src/theme.css",
        fs,
        specifier: "@xyflow/react/dist/style.css",
      })
    ).toEqual({
      isDirectory: false,
      path: "/repo/packages/ui/node_modules/@xyflow/react/dist/style.css",
    });
  });

  it("resolves relative imports", () => {
    const fs = memoryFs({
      "/repo/src/app/globals.css": "/* */",
      "/repo/src/app/local.css": "/* local */",
    });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/src/app/globals.css",
        fs,
        specifier: "./local.css",
      })
    ).toEqual({ isDirectory: false, path: "/repo/src/app/local.css" });
  });

  it("resolves @source directories when allowDirectory is set", () => {
    const fs = memoryFs({
      "/repo/src/renderer/app/globals.css": "/* */",
      "/repo/packages/ui/src": "dir",
      "/repo/packages/ui/src/button.tsx": "export {}",
    });
    expect(
      resolveCssImportPath({
        allowDirectory: true,
        fromFilePath: "/repo/src/renderer/app/globals.css",
        fs,
        specifier: "../../../packages/ui/src",
      })
    ).toEqual({ isDirectory: true, path: "/repo/packages/ui/src" });
    expect(
      resolveCssImportPath({
        fromFilePath: "/repo/src/renderer/app/globals.css",
        fs,
        specifier: "../../../packages/ui/src",
      })
    ).toBeNull();
  });
});

describe("resolveCssImportOnDisk (pier workspace)", () => {
  const fromFilePath = resolve("src/renderer/app/globals.css");

  it("resolves globals.css package imports used in pier", () => {
    if (!existsSync(fromFilePath)) {
      return;
    }
    const cases: Array<{ expectContains: string; specifier: string }> = [
      { expectContains: "tailwindcss", specifier: "tailwindcss" },
      { expectContains: "tw-animate", specifier: "tw-animate-css" },
      { expectContains: "tailwind.css", specifier: "shadcn/tailwind.css" },
      {
        expectContains: "tailwind-theme.css",
        specifier: "@pier/ui/tailwind-theme.css",
      },
    ];
    for (const entry of cases) {
      const resolved = resolveCssImportOnDisk({
        fromFilePath,
        specifier: entry.specifier,
      });
      expect(resolved, entry.specifier).toBeTruthy();
      expect(resolved?.path, entry.specifier).toContain(entry.expectContains);
      expect(resolved?.isDirectory, entry.specifier).toBe(false);
      expect(existsSync(resolved?.path as string), entry.specifier).toBe(true);
    }
  });

  it("resolves @xyflow style from globals.css via packages/*/node_modules", () => {
    if (!existsSync(fromFilePath)) {
      return;
    }
    const resolved = resolveCssImportOnDisk({
      fromFilePath,
      specifier: "@xyflow/react/dist/style.css",
    });
    expect(resolved, "@xyflow from globals.css").toBeTruthy();
    expect(resolved?.path).toContain("@xyflow");
    expect(existsSync(resolved?.path as string)).toBe(true);
  });

  it("resolves @source relative directory from globals.css", () => {
    if (!existsSync(fromFilePath)) {
      return;
    }
    const resolved = resolveCssImportOnDisk({
      allowDirectory: true,
      fromFilePath,
      specifier: "../../../packages/ui/src",
    });
    expect(resolved?.isDirectory).toBe(true);
    expect(resolved?.path).toContain("packages/ui/src");
    expect(existsSync(resolved?.path as string)).toBe(true);
  });
});
