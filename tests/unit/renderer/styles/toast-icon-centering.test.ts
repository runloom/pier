import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const GLOBALS = join(ROOT, "src/renderer/app/globals.css");
const STATUS_ICON = join(ROOT, "packages/ui/src/status-icon.tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("toast status icon centering", () => {
  it("resets Sonner's negative nested-svg margin inside the Pier toast icon", () => {
    // Sonner 默认给 [data-icon] svg 加 -1px 左外边距，使 16px StatusIcon
    // 盒内的对勾左偏 0.5px（2x 下 1 个设备像素）。Pier 必须清零。
    const css = read(GLOBALS);
    const selector =
      "[data-sonner-toast].pier-toast:not(.pier-msg-toast) [data-icon] svg";
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    expect(rule).toContain("margin: 0 !important");
  });

  it("centers oversized toast icons such as the 18px loading spinner", () => {
    const css = read(GLOBALS);
    const selector =
      "[data-sonner-toast].pier-toast:not(.pier-msg-toast) [data-icon] {";
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    expect(rule).toContain("justify-content: center !important");
  });

  it("keeps the shared StatusIcon shell flex-centered", () => {
    expect(read(STATUS_ICON)).toContain(
      "flex shrink-0 items-center justify-center rounded-full"
    );
  });
});
