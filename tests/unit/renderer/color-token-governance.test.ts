import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(css|html|js|jsx|mjs|scss|svg|ts|tsx)$/;
const RAW_COLOR_RE =
  /(?<![\w])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\da-f\w])|\b(?:hsl|hsla|oklab|oklch|rgb|rgba)\s*\(/i;
const FIXED_TAILWIND_COLOR_RE =
  /\b(?:accent|bg|border|caret|decoration|divide|fill|from|outline|placeholder|ring|shadow|stroke|text|to|via)-(?:black|white|(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3})\b/;
const FIXED_TAILWIND_COLOR_VAR_RE =
  /--color-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3}\b/;
const SKIPPED_DIRECTORIES = new Set(["build", "dist", "node_modules", "out"]);
const RAW_COLOR_WHOLE_FILE_OWNERS = new Set([
  "src/renderer/app/globals.css",
  "src/renderer/components/agent-icons/glyphs.tsx",
  "src/renderer/lib/theme/derive-terminal-colors.ts",
  "src/renderer/lib/theme/derive-tokens.ts",
  "src/renderer/lib/theme/oklch.ts",
  "src/shared/theme-colors.ts",
]);
const RAW_COLOR_LITERAL_ALLOWANCES = new Map<string, RegExp>([
  ["packages/ui/src/chart.tsx", /#(?:ccc|fff)\b/gi],
  ["src/renderer/index.html", /#1e1e1e\b/gi],
]);
const COLOR_MIX_OWNERS = new Set([
  "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
  "src/renderer/app/globals.css",
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        files.push(...sourceFiles(filePath));
      }
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split(sep).join("/");
}

function containsUnauthorizedRawColor(filePath: string): boolean {
  const relativePath = projectRelative(filePath);
  if (RAW_COLOR_WHOLE_FILE_OWNERS.has(relativePath)) {
    return false;
  }
  const allowance = RAW_COLOR_LITERAL_ALLOWANCES.get(relativePath);
  const source = readFileSync(filePath, "utf8");
  return RAW_COLOR_RE.test(allowance ? source.replace(allowance, "") : source);
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!match?.[1]) throw new Error(`missing CSS block: ${selector}`);
  return match[1];
}

function cssVariable(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match?.[1]) throw new Error(`missing CSS variable: --${name}`);
  return match[1].trim();
}

function neutralOklchLightness(value: string): number {
  const match = /^oklch\(([\d.]+)\s+0\s+0\)$/.exec(value);
  if (!match?.[1]) throw new Error(`expected neutral OKLCH value: ${value}`);
  return Number.parseFloat(match[1]);
}

function encodedNeutralChannel(lightness: number): number {
  const linear = lightness ** 3;
  return linear <= 0.003_130_8
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055;
}

function linearChannel(encoded: number): number {
  return encoded <= 0.040_45
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

describe("color token governance", () => {
  const files = [join(ROOT, "src"), join(ROOT, "packages")].flatMap(
    sourceFiles
  );

  it("documents one-way color ownership in the project context", () => {
    const context = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

    expect(context).toContain("### 颜色使用规范");
    expect(context).toContain("主题原色 → 语义令牌 → 组件变体 → 业务映射");
  });

  it("keeps raw colors inside explicit palette, theme, native, or brand owners", () => {
    const offenders = files
      .filter(containsUnauthorizedRawColor)
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("keeps color derivation inside the palette or an explicit editor engine", () => {
    const offenders = files
      .filter((filePath) => !COLOR_MIX_OWNERS.has(projectRelative(filePath)))
      .filter((filePath) =>
        /\bcolor-mix\s*\(/i.test(readFileSync(filePath, "utf8"))
      )
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("forbids fixed Tailwind palette classes and variables in production source", () => {
    const offenders = files
      .filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return (
          FIXED_TAILWIND_COLOR_RE.test(source) ||
          FIXED_TAILWIND_COLOR_VAR_RE.test(source)
        );
      })
      .map(projectRelative);

    expect(offenders).toEqual([]);
  });

  it("keeps neutral actions independent from semantic state colors", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const button = readFileSync(
      join(ROOT, "packages/ui/src/button.tsx"),
      "utf8"
    );

    expect(globals).toContain("--action-accent: var(--primary)");
    expect(globals).toContain("--action-danger: var(--destructive)");
    expect(globals).toContain("--action-muted: var(--muted-foreground)");
    expect(button).toContain("bg-action-accent");
    expect(button).toContain("text-action-danger");
    expect(button).not.toContain("text-status-info-fg");
  });

  it("maps quota health and cost charts to existing semantic colors", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const themeTokens = readFileSync(
      join(ROOT, "packages/ui/src/tailwind-theme.css"),
      "utf8"
    );
    const progress = readFileSync(
      join(ROOT, "packages/ui/src/progress.tsx"),
      "utf8"
    );

    expect(globals).not.toContain("--data-primary:");
    expect(globals).not.toContain("--data-cost:");
    expect(themeTokens).not.toContain("--color-data-primary:");
    expect(themeTokens).not.toContain("--color-data-cost:");
    expect(progress).toContain('success: "bg-success"');
    expect(progress).toContain('warning: "bg-warning"');
    expect(progress).toContain('destructive: "bg-destructive"');
    expect(progress).not.toContain('data: "bg-data-primary"');
  });

  // ── Soft status surfaces (Ant Design Alert map tokens) ─────────────
  // Soft alerts/badges use colorXxxBg + colorXxxBorder + colorXxx for icon.
  // Title/description stay on neutral foreground (not tinted). Solid
  // white-on-status contrast is intentionally not required for light seeds
  // like Ant Design's #faad14 / #52c41a / #1677ff.

  it("keeps Ant Design soft status map tokens for both themes", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const light = cssBlock(globals, ":root.light");
    const dark = cssBlock(globals, ":root");

    expect(cssVariable(light, "status-warning-bg")).toBe("#fffbe6");
    expect(cssVariable(light, "status-warning-border")).toBe("#ffe58f");
    expect(cssVariable(light, "status-warning-fg")).toBe("#faad14");
    expect(cssVariable(light, "warning")).toBe("#faad14");

    expect(cssVariable(dark, "status-warning-bg")).toBe("#2b2111");
    expect(cssVariable(dark, "status-warning-border")).toBe("#594214");
    expect(cssVariable(dark, "status-warning-fg")).toBe("#d89614");
    expect(cssVariable(dark, "warning")).toBe("#d89614");

    expect(cssVariable(light, "status-info-bg")).toBe("#e6f4ff");
    expect(cssVariable(light, "status-success-bg")).toBe("#f6ffed");
    expect(cssVariable(light, "status-danger-bg")).toBe("#fff2f0");
    expect(cssVariable(dark, "status-info-bg")).toBe("#111a2c");
    expect(cssVariable(dark, "status-success-bg")).toBe("#162312");
    expect(cssVariable(dark, "status-danger-bg")).toBe("#2c1618");
  });

  // ── Tier 3: design decision — solid status seeds vs white glyphs ────
  // Both themes now use Ant Design status seeds that are chromatic fills /
  // icons, not white-on-solid badge bases. WCAG luminance-only ratios for
  // white glyphs on these seeds are often < 3:1; toast solid glyphs keep a
  // dark capsule surround. Soft alerts put neutral text on soft surfaces.

  it("documents solid status seed tokens exist in both themes", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    for (const block of [
      cssBlock(globals, ":root"),
      cssBlock(globals, ":root.light"),
    ]) {
      expect(cssVariable(block, "status-solid-foreground")).toBeTruthy();
      for (const token of [
        "destructive",
        "warning",
        "success",
        "info",
        "done",
      ]) {
        expect(cssVariable(block, token)).toBeTruthy();
      }
    }
  });

  it("keeps the lowest shimmer text step readable in both themes", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const shimmerMix = cssVariable(globals, "shimmer-low");
    const alphaMatch = /var\(--foreground\)\s+([\d.]+)%/.exec(shimmerMix);
    if (!alphaMatch?.[1]) throw new Error("missing shimmer foreground weight");
    const alpha = Number.parseFloat(alphaMatch[1]) / 100;
    for (const block of [
      cssBlock(globals, ":root"),
      cssBlock(globals, ":root.light"),
    ]) {
      const foreground = encodedNeutralChannel(
        neutralOklchLightness(cssVariable(block, "foreground"))
      );
      const background = encodedNeutralChannel(
        neutralOklchLightness(cssVariable(block, "background"))
      );
      const composited = foreground * alpha + background * (1 - alpha);
      expect(
        contrastRatio(linearChannel(composited), linearChannel(background))
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("binds toast surfaces and glyphs to contrast-safe semantic tokens", () => {
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const sonner = readFileSync(
      join(ROOT, "src/renderer/components/primitives/sonner.tsx"),
      "utf8"
    );
    const statusIcon = readFileSync(
      join(ROOT, "packages/ui/src/status-icon.tsx"),
      "utf8"
    );
    for (const block of [
      cssBlock(globals, ":root"),
      cssBlock(globals, ":root.light"),
    ]) {
      const surface = neutralOklchLightness(
        cssVariable(block, "toast-surface")
      );
      const foreground = neutralOklchLightness(
        cssVariable(block, "toast-foreground")
      );
      expect(
        contrastRatio(surface ** 3, foreground ** 3)
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(globals).toContain("--toast-action-bg:");
    expect(sonner).toContain('"--normal-bg": "var(--toast-surface)"');
    expect(sonner).toContain('"--normal-text": "var(--toast-foreground)"');
    expect(sonner).toContain('StatusIcon kind="success"');
    expect(sonner).toContain('StatusIcon kind="warning"');
    expect(statusIcon).toContain("text-status-solid-foreground");
    expect(statusIcon).toContain("var(--warning)");
    expect(sonner).not.toContain("text-[color:var(--toast-surface)]");
  });
});
