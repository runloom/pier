import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIcns } from "../../../scripts/app-icon-icns.mjs";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const EXPECTED_ICNS_FRAME_HASHES = {
  icp4: "d19bd4e91c1cad0ebd05f7ff3356867e6de55230eaed236aa43c0774974410d9",
  icp5: "c4f670863fa086b9dfc923153bb520348131f7829b97e0c7b90e913157cd33b7",
  icp6: "77c563f7ac8239944a993cc05879ec633a1b8811a6153d1c100e4ba37a239144",
  ic07: "b7523263ddab5bcbd4085fcf28ed321ae0f160e876c7cd2e5fdc57916cb636c3",
  ic08: "78393d531bec6c8fe661a56d6ad51102e7274b344bf341a511e11a5056aec61c",
  ic09: "d29a33f99def9b356042dae73ec0820b1728e20173fc8ca3fc7240e966a27cdb",
  ic10: "a9ae3dda2f0f6be5a9407a9814ffccd8170252d6caa3ad44be7e3b5eca668f8e",
  ic11: "c4f670863fa086b9dfc923153bb520348131f7829b97e0c7b90e913157cd33b7",
  ic12: "77c563f7ac8239944a993cc05879ec633a1b8811a6153d1c100e4ba37a239144",
  ic13: "d29a33f99def9b356042dae73ec0820b1728e20173fc8ca3fc7240e966a27cdb",
  ic14: "a9ae3dda2f0f6be5a9407a9814ffccd8170252d6caa3ad44be7e3b5eca668f8e",
} as const;

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

  it("ships Micro ICNS frames through 128px and Standard frames above it", () => {
    const icns = readFileSync(join(ROOT, "build/icon.icns"));
    const actual = Object.fromEntries(
      parseIcns(icns).map((entry) => [entry.type, sha256Bytes(entry.data)])
    );

    expect(actual).toEqual(EXPECTED_ICNS_FRAME_HASHES);
  });

  it("uses the approved Micro rendition for the development Dock", () => {
    const dockIcon = readFileSync(join(ROOT, "build/icon.png"));

    expect(sha256Bytes(dockIcon)).toBe(
      "26742aaa53f47aa8dbc8a33c7e77caba6220a5895cfd39ff8913267fe634ef32"
    );
  });
});
