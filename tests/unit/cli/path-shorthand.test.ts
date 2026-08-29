import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePierCliArgs } from "../../../bin/pier-cli-parser.js";
import {
  expandHome,
  looksLikePathToken,
  parsePathLocationToken,
} from "../../../bin/pier-cli-path.js";

const tempDirs: string[] = [];

function asV1(parsed: ReturnType<typeof parsePierCliArgs>) {
  if (parsed.protocol !== "v1") {
    throw new Error("expected v1");
  }
  return parsed;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

beforeEach(() => {
  vi.stubEnv("PIER_PANEL_ID", "");
  vi.stubEnv("PIER_WINDOW_ID", "");
});

describe("parsePathLocationToken", () => {
  it("strips :line:col from argv tokens", () => {
    expect(parsePathLocationToken("app.ts:12:3")).toEqual({
      column: 3,
      line: 12,
      path: "app.ts",
    });
    expect(parsePathLocationToken("app.ts:12")).toEqual({
      line: 12,
      path: "app.ts",
    });
  });

  it("does not treat C: drive as a line suffix", () => {
    expect(parsePathLocationToken("C:")).toEqual({ path: "C:" });
  });
});

describe("path shorthand parser", () => {
  it("prints envelope for pier a.ts:12:3", () => {
    const parsed = asV1(
      parsePierCliArgs(["a.ts:12:3", "--print-envelope", "--json"], {
        cwd: "/Users/me/proj",
        requestId: "req-loc",
      })
    );
    expect(parsed.envelope.command).toEqual({
      path: "/Users/me/proj/a.ts",
      paths: [{ column: 3, line: 12, path: "/Users/me/proj/a.ts" }],
      type: "panel.open",
    });
  });

  it("expands quoted-style ~/proj", () => {
    expect(expandHome("~/proj")).toBe(`${homedir()}/proj`);
    const parsed = asV1(
      parsePierCliArgs(["~/proj"], {
        cwd: "/tmp",
        requestId: "req-home",
      })
    );
    expect(parsed.envelope.command).toMatchObject({
      path: `${homedir()}/proj`,
      type: "panel.open",
    });
  });

  it("keeps pier status as a command even if a status folder exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-status-folder-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "status"));
    expect(
      asV1(parsePierCliArgs(["status"], { cwd: dir, requestId: "req-status" }))
        .envelope.command
    ).toEqual({ type: "app.status" });
  });

  it("treats pier ./status as a path", () => {
    const parsed = asV1(
      parsePierCliArgs(["./status"], {
        cwd: "/Users/dev/ABC/pier",
        requestId: "req-dot-status",
      })
    );
    expect(parsed.envelope.command).toMatchObject({
      path: "/Users/dev/ABC/pier/status",
      type: "panel.open",
    });
  });

  it("treats Dockerfile as a path only when it exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-docker-"));
    tempDirs.push(dir);
    expect(looksLikePathToken("Dockerfile", dir)).toBe(false);
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    expect(looksLikePathToken("Dockerfile", dir)).toBe(true);
  });

  it("rejects nosuchdir as unknown command", () => {
    expect(() =>
      parsePierCliArgs(["nosuchdir"], { cwd: "/tmp", requestId: "req-miss" })
    ).toThrow(/unknown pier CLI command/u);
  });

  it("accepts ./nosuchdir as a path", () => {
    const parsed = asV1(
      parsePierCliArgs(["./nosuchdir"], {
        cwd: "/tmp",
        requestId: "req-rel-miss",
      })
    );
    expect(parsed.envelope.command).toMatchObject({
      path: "/tmp/nosuchdir",
      type: "panel.open",
    });
  });

  it("collects mixed paths including line numbers", () => {
    const parsed = asV1(
      parsePierCliArgs([".", "src/a.ts", "README.md:10"], {
        cwd: "/Users/me/proj",
        requestId: "req-mix",
      })
    );
    expect(parsed.envelope.command).toEqual({
      path: "/Users/me/proj",
      paths: [
        { path: "/Users/me/proj" },
        { path: "/Users/me/proj/src/a.ts" },
        { line: 10, path: "/Users/me/proj/README.md" },
      ],
      type: "panel.open",
    });
  });

  it("maps --split right to placement and skips nothing in the envelope", () => {
    const parsed = asV1(
      parsePierCliArgs([".", "--split", "right"], {
        cwd: "/Users/me/proj",
        requestId: "req-split",
      })
    );
    expect(parsed.envelope.command).toEqual({
      path: "/Users/me/proj",
      paths: [{ path: "/Users/me/proj" }],
      placement: "split-right",
      type: "panel.open",
    });
  });

  it("injects nested origin without --window", () => {
    vi.stubEnv("PIER_PANEL_ID", "terminal-1");
    vi.stubEnv("PIER_WINDOW_ID", "3");
    try {
      const parsed = asV1(
        parsePierCliArgs(["."], {
          cwd: "/Users/me/proj",
          requestId: "req-nested",
        })
      );
      expect(parsed.envelope.command).toMatchObject({
        path: "/Users/me/proj",
        referencePanelId: "terminal-1",
        type: "panel.open",
        windowId: "3",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not write referencePanelId when --window is set", () => {
    vi.stubEnv("PIER_PANEL_ID", "terminal-1");
    vi.stubEnv("PIER_WINDOW_ID", "3");
    try {
      const parsed = asV1(
        parsePierCliArgs([".", "--window", "other"], {
          cwd: "/Users/me/proj",
          requestId: "req-win",
        })
      );
      expect(parsed.envelope.command).toMatchObject({
        type: "panel.open",
        windowId: "other",
      });
      expect(parsed.envelope.command).not.toHaveProperty("referencePanelId");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("parses nested bare pier as panel.focus", () => {
    vi.stubEnv("PIER_PANEL_ID", "terminal-1");
    vi.stubEnv("PIER_WINDOW_ID", "3");
    try {
      const parsed = asV1(
        parsePierCliArgs(["--print-envelope", "--json"], {
          cwd: "/tmp",
          requestId: "req-bare",
        })
      );
      expect(parsed.envelope.command).toEqual({
        panelId: "terminal-1",
        type: "panel.focus",
        windowId: "3",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("parses nested bare pier --no-focus", () => {
    vi.stubEnv("PIER_PANEL_ID", "terminal-1");
    vi.stubEnv("PIER_WINDOW_ID", "3");
    try {
      const parsed = asV1(
        parsePierCliArgs(["--no-focus"], {
          cwd: "/tmp",
          requestId: "req-bare-nf",
        })
      );
      expect(parsed.envelope.command).toEqual({
        focus: false,
        panelId: "terminal-1",
        type: "panel.focus",
        windowId: "3",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("parses nested bare pier --window as window.focus", () => {
    vi.stubEnv("PIER_PANEL_ID", "terminal-1");
    vi.stubEnv("PIER_WINDOW_ID", "3");
    try {
      const parsed = asV1(
        parsePierCliArgs(["--window", "other"], {
          cwd: "/tmp",
          requestId: "req-bare-win",
        })
      );
      expect(parsed.envelope.command).toEqual({
        type: "window.focus",
        windowId: "other",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("packs new bin/pier-cli-*.js files in extraResources", () => {
    const yml = readFileSync("electron-builder.yml", "utf8");
    expect(yml).toMatch(/from:\s*bin\/pier-cli-path\.js/);
    expect(yml).toMatch(/from:\s*bin\/pier-cli-launch\.js/);
    const parser = readFileSync("bin/pier-cli-parser.js", "utf8");
    const main = readFileSync("bin/pier.mjs", "utf8");
    for (const source of [parser, main]) {
      const imports = [
        ...source.matchAll(/from "\.\/(pier-cli-[^"]+\.js)"/g),
      ].map((match) => match[1]);
      for (const file of imports) {
        expect(yml).toMatch(new RegExp(`from:\\s*bin/${file}`));
      }
    }
  });
});
