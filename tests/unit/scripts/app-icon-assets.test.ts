import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Pier application icon sources", () => {
  it("locks the approved F and I renditions byte-for-byte", () => {
    expect(sha256(read("build/app-icon-master.svg"))).toBe(
      "ed1f59e2d4f95f62ed4a3336999f83e72003f31449a842b70f2d21b6e7ce8f2d"
    );
    expect(sha256(read("build/app-icon-micro.svg"))).toBe(
      "8e3387d34d9eef1861d3e1768798ca09be1d07c087aed2ea2426afe95eb17ae3"
    );
  });

  it("keeps the approved Micro optical corrections", () => {
    const micro = read("build/app-icon-micro.svg");

    expect(micro).toMatch(/id="screen-left-top-glow"[^>]*opacity="0"/);
    expect(micro).toMatch(/id="terminal-material-effects"[^>]*opacity="0"/);
    expect(micro).toContain('stroke-width="6.6"');
    expect(micro).toContain('stroke-width="7"');
    expect(micro).toContain("2.4 19-17.6 35-40 35");
  });

  it("keeps transparent F exports free of the macOS plate", () => {
    const mark = read("build/design-sources/pier-logo.svg");
    const unplated = read("build/app-icon-unplated.svg");

    expect(mark).toContain('viewBox="0 0 210 170"');
    expect(mark).toContain(
      'id="berth-layer" transform="translate(104.5 145) scale(0.9) translate(-104.5 -145)"'
    );
    expect(mark).not.toContain("app-plate-fill");
    expect(unplated).not.toContain("app-plate-fill");
  });

  it("ships vector-only sources", () => {
    for (const path of [
      "build/app-icon-master.svg",
      "build/app-icon-micro.svg",
      "build/design-sources/pier-logo.svg",
      "build/app-icon-unplated.svg",
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/<image(?:\s|>)/i);
      expect(source).not.toMatch(/<text(?:\s|>)/i);
      expect(source).not.toMatch(/(?:base64|data:|\shref=)/i);
    }
  });
});
