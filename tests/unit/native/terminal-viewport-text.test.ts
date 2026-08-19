import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal"
);
const GHOSTTY_TEXT = join(ROOT, "Surface/GhosttyText.swift");
const CACHE = join(ROOT, "Surface/ViewportTextCache.swift");
const SURFACE = join(ROOT, "Surface/TerminalSurface.swift");
const SESSION = join(ROOT, "InMemory/InMemoryTerminalSession.swift");
const COORDINATOR = join(ROOT, "Surface/TerminalSurfaceCoordinator.swift");

const MAP_COPY = String.raw`\.map\s*\{\s*UInt8\(bitPattern:`;

describe("native viewport text dump", () => {
  it("decodes ghostty_text_s without an intermediate Array copy", () => {
    const source = readFileSync(GHOSTTY_TEXT, "utf8");
    expect(source).toContain("String(decoding: UnsafeBufferPointer");
    expect(source).toContain("ghostty_surface_free_text");
    expect(source).not.toMatch(new RegExp(MAP_COPY, "u"));
  });

  it("reuses ViewportTextCache on TerminalSurface and in-memory sessions", () => {
    expect(readFileSync(CACHE, "utf8")).toContain("mutating func read(dump:");
    const surface = readFileSync(SURFACE, "utf8");
    const session = readFileSync(SESSION, "utf8");
    expect(surface).toContain("viewportTextCache.read");
    expect(session).toContain("viewportTextCache.read");
    expect(surface).not.toMatch(new RegExp(MAP_COPY, "u"));
    expect(session).not.toMatch(new RegExp(MAP_COPY, "u"));
  });

  it("invalidates the viewport cache when Ghostty reports a new frame", () => {
    expect(readFileSync(COORDINATOR, "utf8")).toContain(
      "surface?.noteViewportChanged()"
    );
  });

  it("dumps uncached viewport text while the surface is occluded", () => {
    const surface = readFileSync(SURFACE, "utf8");
    expect(surface).toContain("occlusionVisible");
    expect(surface).toContain("readUncached");
    expect(surface).toContain("ghostty_surface_set_occlusion");
  });

  it("does not bump the in-memory cache on a no-op resize", () => {
    const session = readFileSync(SESSION, "utf8");
    const updateStart = session.indexOf("func updateViewport");
    const receiveStart = session.indexOf("public func receive(_ data: Data)");
    expect(updateStart).toBeGreaterThan(-1);
    expect(receiveStart).toBeGreaterThan(updateStart);
    expect(session.slice(updateStart, receiveStart)).not.toContain(
      "noteChanged"
    );
    expect(session).toContain("lastResize = mergedResize");
    expect(session).toContain("viewportTextCache.noteChanged()");
  });
});
