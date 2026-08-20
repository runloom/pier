import { describe, expect, it } from "vitest";
import {
  shouldNeverSystemOpen,
  splitAbsoluteDiskTarget,
} from "../../../src/shared/system-open-guard.ts";

describe("shouldNeverSystemOpen", () => {
  it("blocks TypeScript extensions (macOS MPEG-TS collision)", () => {
    expect(shouldNeverSystemOpen("/repo/a.ts")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/a.tsx")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/a.mts")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/a.cts")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/a.TS")).toBe(true);
    expect(
      shouldNeverSystemOpen(
        "tests/unit/main/project-skills/system-skills-catalog.test.ts"
      )
    ).toBe(true);
    expect(shouldNeverSystemOpen("/repo/types.d.ts")).toBe(true);
  });

  it("blocks common source and text extensions", () => {
    expect(shouldNeverSystemOpen("/repo/a.js")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/README.md")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/package.json")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/theme.less")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/theme.sass")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/Page.astro")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/schema.graphql")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/main.tf")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/.env")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/.gitignore")).toBe(true);
  });

  it("blocks known extensionless basenames", () => {
    expect(shouldNeverSystemOpen("/repo/Dockerfile")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/Makefile")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/go.mod")).toBe(true);
    expect(shouldNeverSystemOpen("/repo/Cargo.toml")).toBe(true);
  });

  it("allows media and archives for OS open", () => {
    expect(shouldNeverSystemOpen("/repo/clip.mp4")).toBe(false);
    expect(shouldNeverSystemOpen("/repo/photo.png")).toBe(false);
    expect(shouldNeverSystemOpen("/repo/a.zip")).toBe(false);
    expect(shouldNeverSystemOpen("/repo/data.bin")).toBe(false);
  });

  it("does not treat dockerfile as an extension alone for random names", () => {
    // Still blocked via extension list only if ends with .dockerfile
    expect(shouldNeverSystemOpen("/repo/app.dockerfile")).toBe(false);
  });
});

describe("splitAbsoluteDiskTarget", () => {
  it("splits parent root and leaf path", () => {
    expect(splitAbsoluteDiskTarget("/repo/src/a.ts")).toEqual({
      root: "/repo/src",
      path: "a.ts",
    });
    expect(splitAbsoluteDiskTarget("/tmp/outside.md")).toEqual({
      root: "/tmp",
      path: "outside.md",
    });
  });
});
