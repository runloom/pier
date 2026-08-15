import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_CHIP_TONE_COMMAND,
  COMPOSER_CHIP_TONE_SKILL,
} from "@/panel-kits/terminal/structured-composer/composer-chip-styles.ts";

const ROOT = process.cwd();
const COMPOSER_DIR = join(
  ROOT,
  "src",
  "renderer",
  "panel-kits",
  "terminal",
  "structured-composer"
);

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function readComposer(fileName: string): string {
  return readFileSync(join(COMPOSER_DIR, fileName), "utf8");
}

describe("composer chip inline alignment", () => {
  it("shared pill inherits editor em and exports the label baseline", () => {
    expect(COMPOSER_CHIP_CLASS).toContain("inline-flex");
    expect(COMPOSER_CHIP_CLASS).toContain("items-baseline");
    expect(COMPOSER_CHIP_CLASS).toContain("text-[1em]");
    expect(COMPOSER_CHIP_CLASS).toContain("leading-none");
    expect(COMPOSER_CHIP_CLASS).toContain("py-px");
    expect(COMPOSER_CHIP_CLASS).not.toMatch(/\bh-5\b/);
    expect(COMPOSER_CHIP_CLASS).not.toContain("max-h-5");
    expect(COMPOSER_CHIP_CLASS).not.toContain("text-[0.85em]");
    expect(COMPOSER_CHIP_CLASS).not.toMatch(/\bfont-mono\b/);
    expect(COMPOSER_CHIP_CLASS).not.toContain("items-center");
  });

  it("host baseline-aligns and does not match leading-5 height", () => {
    const css = read("src/renderer/app/globals.css");
    const host = css.slice(
      css.indexOf(".composer-ref-chip-host {"),
      css.indexOf(".composer-editor-input")
    );
    expect(host).toContain("display: inline-flex");
    expect(host).toContain("align-items: baseline");
    expect(host).toContain("vertical-align: baseline");
    expect(host).not.toContain("height: 1.25rem");
    expect(host).not.toContain("vertical-align: middle");
    expect(host).toContain("height: 0");
    expect(host).toContain("align-self: center");
  });

  it("identifier labels keep mono; attachment ordinal stays tabular sans", () => {
    const path = readComposer("workspace-path-mention-node.tsx");
    const skill = readComposer("skill-mention-node.tsx");
    const attach = readComposer("attachment-token-node.tsx");
    expect(path).toMatch(/className="truncate font-mono"/);
    expect(skill).toMatch(/className="truncate font-mono"/);
    expect(attach).toContain('className="tabular-nums"');
    expect(attach).not.toMatch(/font-mono/);
  });

  it("command and skill chips share the invoke status triad", () => {
    expect(COMPOSER_CHIP_TONE_COMMAND).toBe(COMPOSER_CHIP_TONE_SKILL);
    expect(COMPOSER_CHIP_TONE_COMMAND).toContain("status-success");
    expect(COMPOSER_CHIP_TONE_COMMAND).not.toContain("secondary");
    expect(COMPOSER_CHIP_TONE_COMMAND).not.toContain("muted");
    expect(COMPOSER_CHIP_TONE_COMMAND).not.toContain("status-neutral");
    expect(COMPOSER_CHIP_TONE_COMMAND).not.toContain("text-foreground");
  });

  it("icons self-center so the pill baseline stays on the label", () => {
    expect(readComposer("attachment-token-node.tsx")).toContain("self-center");
    expect(readComposer("skill-mention-node.tsx")).toContain("self-center");
    expect(readComposer("workspace-path-mention-node.tsx")).toContain(
      "self-center"
    );
    expect(readComposer("review-comments-chip-node.tsx")).toContain(
      "self-center"
    );
  });
});
