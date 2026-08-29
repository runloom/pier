import {
  fileNameFromTabIconId,
  fileTabIconId,
  PierFileIcon,
} from "@pier/ui/file/icon.tsx";
import {
  isCanvasFileIconName,
  mergeCustomFileIconsIntoBuiltInSpriteSheet,
  PIER_CANVAS_FILE_EXTENSIONS,
  PIER_CANVAS_FILE_ICON_SYMBOL,
  PIER_CANVAS_FILE_ICON_SYMBOL_ID,
  PIER_CANVAS_FILE_ICON_TOKEN,
  PIER_DART_FILE_ICON_SYMBOL,
  PIER_DART_FILE_ICON_SYMBOL_ID,
  PIER_DART_FILE_NAMES,
  PIER_FILE_ICON_CUSTOM_SPRITE_SHEET,
  PIER_FILE_TREE_ICONS,
  PIER_GO_FILE_NAMES,
  PIER_MANIFEST_FILE_ICONS,
  SIMPLE_ICONS_DART_PATH,
} from "@pier/ui/file/icon-config.ts";
import {
  pierFileTreeStyle,
  TREE_SCROLLBAR_CSS,
} from "@pier/ui/file/tree-style.ts";
import { LIVE_MODULE_CANVAS_FILE_SUFFIXES } from "@shared/live-module-framework.ts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

describe("Pier file icon", () => {
  afterEach(() => {
    document.querySelector('[data-pier-file-icon-sprite="true"]')?.remove();
  });
  it("encodes only the basename in a namespaced tab icon id", () => {
    const iconId = fileTabIconId("src/components/file.tsx");

    expect(iconId).toBe("pier.file:file.tsx");
    expect(fileNameFromTabIconId(iconId)).toBe("file.tsx");
    expect(fileNameFromTabIconId("pier.file:%E0%A4%A")).toBeNull();
    expect(fileNameFromTabIconId("terminal")).toBeNull();
  });

  it("keeps canvas icon extensions aligned with live-module framework suffixes", () => {
    const fromFramework = new Set(
      LIVE_MODULE_CANVAS_FILE_SUFFIXES.map((suffix) =>
        suffix.startsWith(".") ? suffix.slice(1) : suffix
      )
    );
    const fromIcons = new Set<string>(PIER_CANVAS_FILE_EXTENSIONS);
    expect([...fromIcons].sort()).toEqual([...fromFramework].sort());
  });

  it("omits native title when aria-hidden so host tooltips are the only name surface", () => {
    const { container } = render(
      <PierFileIcon aria-hidden="true" fileName="main.ts" />
    );
    expect(container.querySelector("title")).toBeNull();
  });

  it("keeps native title for labeled icons", () => {
    const { container } = render(<PierFileIcon fileName="main.ts" />);
    expect(container.querySelector("title")?.textContent).toBe("main.ts");
  });

  it("uses the complete file-tree resolver and shared color token", () => {
    const { container } = render(<PierFileIcon fileName="src/file.ts" />);
    const icon = container.querySelector("[data-pier-file-icon]");

    expect(icon).toHaveAttribute("data-icon-token", "typescript");
    expect(icon).toHaveStyle({ color: "var(--pier-file-icon-blue)" });
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-typescript"
    );
    expect(pierFileTreeStyle(undefined)).toMatchObject({
      "--trees-file-icon-color-typescript": "var(--pier-file-icon-blue)",
      "--trees-file-icon-color-canvas": "var(--pier-file-icon-indigo)",
    });
  });

  it("wires tree-only canvas icon config and shadow-DOM color CSS", () => {
    expect(PIER_FILE_TREE_ICONS.set).toBe("complete");
    expect(PIER_FILE_TREE_ICONS.colored).toBe(true);
    expect(PIER_FILE_TREE_ICONS.spriteSheet).toBe(
      PIER_FILE_ICON_CUSTOM_SPRITE_SHEET
    );
    expect(PIER_FILE_ICON_CUSTOM_SPRITE_SHEET).toContain(
      `id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}"`
    );
    for (const extension of PIER_CANVAS_FILE_EXTENSIONS) {
      expect(PIER_FILE_TREE_ICONS.byFileExtension).toHaveProperty(extension);
    }
    expect(TREE_SCROLLBAR_CSS).toContain('[data-icon-token="canvas"]');
    expect(TREE_SCROLLBAR_CSS).toContain("var(--trees-file-icon-color-canvas)");
  });

  it("merges the canvas glyph into the built-in sheet for PierFileIcon", () => {
    const builtIn = `<svg xmlns="http://www.w3.org/2000/svg"><symbol id="file-tree-builtin-typescript"/></svg>`;
    const merged = mergeCustomFileIconsIntoBuiltInSpriteSheet(builtIn);
    expect(merged).toContain(`id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}"`);
    expect(merged).toContain(PIER_CANVAS_FILE_ICON_SYMBOL);
    expect(merged.endsWith("</svg>")).toBe(true);
    // Idempotent when the symbol is already present.
    expect(mergeCustomFileIconsIntoBuiltInSpriteSheet(merged)).toBe(merged);
  });

  it("uses a dedicated canvas glyph for live-module canvas suffixes", () => {
    expect(isCanvasFileIconName("hello.canvas.tsx")).toBe(true);
    expect(isCanvasFileIconName("nested/hello.canvas.vue")).toBe(true);
    expect(isCanvasFileIconName("hello.tsx")).toBe(false);

    const { container } = render(
      <PierFileIcon fileName=".pier/canvases/smoke/hello.canvas.tsx" />
    );
    const icon = container.querySelector("[data-pier-file-icon]");

    expect(icon).toHaveAttribute(
      "data-icon-token",
      PIER_CANVAS_FILE_ICON_TOKEN
    );
    expect(icon).toHaveStyle({ color: "var(--pier-file-icon-indigo)" });
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      `#${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
    );
    expect(
      document.querySelector(
        `[data-pier-file-icon-sprite="true"] #${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
      )
    ).not.toBeNull();
  });

  it.each([
    "hello.canvas.tsx",
    "hello.canvas.jsx",
    "hello.canvas.vue",
    "hello.canvas.svelte",
    "hello.canvas.solid.tsx",
    "hello.canvas.solid.jsx",
  ] as const)("maps %s to the canvas icon token", (fileName) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute(
      "data-icon-token",
      PIER_CANVAS_FILE_ICON_TOKEN
    );
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      `#${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
    );
  });

  it("mounts one shared complete sprite sheet for multiple icons", () => {
    render(
      <>
        <PierFileIcon fileName="file.ts" />
        <PierFileIcon fileName="README.md" />
        <PierFileIcon fileName="hello.canvas.tsx" />
      </>
    );

    expect(
      document.querySelectorAll(
        '[data-pier-file-icon-sprite="true"] #file-tree-builtin-typescript'
      )
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        `[data-pier-file-icon-sprite="true"] #${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
      )
    ).toHaveLength(1);
  });

  it.each([
    ["lib/main.dart", "dart", `#${PIER_DART_FILE_ICON_SYMBOL_ID}`],
    ["App.java", "java", "#file-tree-pier-java"],
    ["Main.kt", "kotlin", "#file-tree-pier-kotlin"],
    ["build.gradle.kts", "kotlin", "#file-tree-pier-kotlin"],
    ["Program.cs", "csharp", "#file-tree-pier-csharp"],
    ["index.php", "php", "#file-tree-pier-php"],
    ["mix.exs", "elixir", "#file-tree-pier-elixir"],
    ["script.lua", "lua", "#file-tree-pier-lua"],
    ["analysis.r", "r", "#file-tree-pier-r"],
    ["notes.rmd", "r", "#file-tree-pier-r"],
    ["Main.scala", "scala", "#file-tree-pier-scala"],
    ["Cargo.toml", "toml", "#file-tree-pier-toml"],
    ["pom.xml", "xml", "#file-tree-pier-xml"],
    ["app.dockerfile", "docker", "#file-tree-builtin-docker"],
    ["main.m", "cpp", "#file-tree-builtin-cpp"],
    ["setup.ps1", "bash", "#file-tree-builtin-bash"],
    ["run.cmd", "bash", "#file-tree-builtin-bash"],
    ["build.zig.zon", "zig", "#file-tree-builtin-zig"],
    ["nomad.hcl", "terraform", "#file-tree-builtin-terraform"],
    ["app_en.arb", "dart", `#${PIER_DART_FILE_ICON_SYMBOL_ID}`],
    [".pubignore", "dart", `#${PIER_DART_FILE_ICON_SYMBOL_ID}`],
    ["build.gradle", "java", "#file-tree-pier-java"],
    ["build.sbt", "scala", "#file-tree-pier-scala"],
    ["App.csproj", "csharp", "#file-tree-pier-csharp"],
    ["App.sln", "csharp", "#file-tree-pier-csharp"],
    ["Lib.fsproj", "csharp", "#file-tree-pier-csharp"],
    ["page.heex", "elixir", "#file-tree-pier-elixir"],
    ["page.eex", "elixir", "#file-tree-pier-elixir"],
    ["page.leex", "elixir", "#file-tree-pier-elixir"],
    ["FindFoo.cmake", "cpp", "#file-tree-builtin-cpp"],
    ["Info.plist", "xml", "#file-tree-pier-xml"],
  ] as const)("maps %s to token %s", (fileName, token, href) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", token);
    expect(icon?.querySelector("use")).toHaveAttribute("href", href);
  });

  it("uses the Simple Icons official Dart silhouette with Pierre optical fit", () => {
    expect(PIER_DART_FILE_ICON_SYMBOL).toContain(SIMPLE_ICONS_DART_PATH);
    expect(PIER_DART_FILE_ICON_SYMBOL).toContain('fill-rule="evenodd"');
    expect(PIER_DART_FILE_ICON_SYMBOL).toContain(
      "translate(1.5 1.5) scale(0.54167)"
    );
    expect(PIER_DART_FILE_NAMES).toEqual([".pubignore"]);
    expect(PIER_FILE_TREE_ICONS.byFileName).not.toHaveProperty("pubspec.yaml");
    expect(PIER_FILE_TREE_ICONS.byFileName).not.toHaveProperty("pubspec.yml");
    expect(PIER_FILE_TREE_ICONS.byFileName).not.toHaveProperty(
      "analysis_options.yaml"
    );
  });

  it.each([
    "pubspec.yaml",
    "pubspec.yml",
    "analysis_options.yaml",
    "pubspec.lock",
    "ci.yaml",
    "data.yml",
    "pnpm-workspace.yaml",
  ] as const)("keeps %s on the Pierre yaml glyph", (fileName) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", "yml");
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-yml"
    );
  });

  it("keeps docker-compose.yml on the Pierre docker glyph", () => {
    const { container } = render(
      <PierFileIcon fileName="docker-compose.yml" />
    );
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", "docker");
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-docker"
    );
  });

  it.each(PIER_GO_FILE_NAMES)("maps %s to the go icon token", (fileName) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", "go");
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-go"
    );
  });

  it.each(
    Object.entries(PIER_MANIFEST_FILE_ICONS)
  )("maps %s to token %s", (fileName, token) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", token);
  });

  it("keeps LICENSE.md on the markdown glyph", () => {
    const { container } = render(<PierFileIcon fileName="LICENSE.md" />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", "markdown");
  });

  it.each([
    "Makefile",
    "Justfile",
    "schema.prisma",
    "flake.nix",
    "notebook.ipynb",
  ] as const)("leaves %s on the default glyph", (fileName) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute("data-icon-token", "default");
  });

  it("uses teal for dart file icons", () => {
    const { container } = render(<PierFileIcon fileName="lib/app.dart" />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveStyle({ color: "var(--pier-file-icon-teal)" });
    expect(pierFileTreeStyle(undefined)).toMatchObject({
      "--trees-file-icon-color-dart": "var(--pier-file-icon-teal)",
    });
  });
});
