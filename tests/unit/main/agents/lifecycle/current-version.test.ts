import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCurrentVersionFromPath } from "../../../../../src/main/services/agents/lifecycle/sources/current-version.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pier-current-ver-"));
  roots.push(root);
  return root;
}

describe("readCurrentVersionFromPath", () => {
  it("reads brew Caskroom version without spawning", () => {
    const root = tempRoot();
    const target = join(
      root,
      "Caskroom",
      "claude-code@latest",
      "2.1.235",
      "claude"
    );
    mkdirSync(join(root, "Caskroom", "claude-code@latest", "2.1.235"), {
      recursive: true,
    });
    writeFileSync(target, "");
    const binPath = join(root, "bin", "claude");
    mkdirSync(join(root, "bin"), { recursive: true });
    symlinkSync(target, binPath);
    expect(readCurrentVersionFromPath(binPath)).toBe("2.1.235");
  });

  it("reads brew Cellar version", () => {
    const root = tempRoot();
    const binPath = join(
      root,
      "Cellar",
      "opencode",
      "1.18.14",
      "bin",
      "opencode"
    );
    mkdirSync(join(root, "Cellar", "opencode", "1.18.14", "bin"), {
      recursive: true,
    });
    writeFileSync(binPath, "");
    expect(readCurrentVersionFromPath(binPath)).toBe("1.18.14");
  });

  it("reads native Claude versions directory via symlink", () => {
    const root = tempRoot();
    const target = join(
      root,
      ".local",
      "share",
      "claude",
      "versions",
      "2.1.241",
      "claude"
    );
    mkdirSync(join(root, ".local", "share", "claude", "versions", "2.1.241"), {
      recursive: true,
    });
    writeFileSync(target, "");
    const binPath = join(root, ".local", "bin", "claude");
    mkdirSync(join(root, ".local", "bin"), { recursive: true });
    symlinkSync(target, binPath);
    expect(readCurrentVersionFromPath(binPath)).toBe("2.1.241");
  });

  it("reads cursor-agent versions directory", () => {
    const root = tempRoot();
    const binPath = join(
      root,
      ".local",
      "share",
      "cursor-agent",
      "versions",
      "2026.08.11-e8db854",
      "cursor-agent"
    );
    mkdirSync(
      join(
        root,
        ".local",
        "share",
        "cursor-agent",
        "versions",
        "2026.08.11-e8db854"
      ),
      {
        recursive: true,
      }
    );
    writeFileSync(binPath, "");
    expect(readCurrentVersionFromPath(binPath)).toBe("2026.08.11-e8db854");
  });

  it("reads npm package.json from node_modules layout", () => {
    const root = tempRoot();
    const pkgRoot = join(
      root,
      "lib",
      "node_modules",
      "@anthropic-ai",
      "claude-code"
    );
    mkdirSync(join(pkgRoot, "bin"), { recursive: true });
    writeFileSync(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-code", version: "2.1.221" })
    );
    const target = join(pkgRoot, "bin", "claude");
    writeFileSync(target, "");
    const binPath = join(root, "bin", "claude");
    mkdirSync(join(root, "bin"), { recursive: true });
    symlinkSync(target, binPath);
    expect(readCurrentVersionFromPath(binPath)).toBe("2.1.221");
  });

  it("returns null for an unknown layout", () => {
    const root = tempRoot();
    const binPath = join(root, "bin", "claude");
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(binPath, "");
    expect(readCurrentVersionFromPath(binPath)).toBeNull();
  });
});
