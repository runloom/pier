import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      file: string,
      args: readonly string[],
      options:
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | object,
      callback?: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      const cb = typeof options === "function" ? options : callback;
      const respond = (err: Error | null, stdout: string) => {
        cb?.(err, stdout, "");
      };
      const urlArg = args.find(
        (arg) => typeof arg === "string" && arg.startsWith("http")
      );

      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("formulae.brew.sh/api/cask/claude-code%40latest.json")
      ) {
        respond(null, JSON.stringify({ version: "2.1.251" }));
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("formulae.brew.sh/api/cask/claude-code.json")
      ) {
        respond(null, JSON.stringify({ version: "2.1.236" }));
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("formulae.brew.sh/api/formula/")
      ) {
        respond(null, JSON.stringify({ versions: { stable: "1.18.14" } }));
        return;
      }
      if (file === "brew" && args.includes("anomalyco/tap/opencode")) {
        respond(
          null,
          JSON.stringify({
            formulae: [{ versions: { stable: "1.18.14" } }],
            casks: [],
          })
        );
        return;
      }
      if (file === "brew" && args.includes("claude-code@latest")) {
        // Stale local index — remote API must win when used.
        respond(
          null,
          JSON.stringify({
            formulae: [],
            casks: [{ version: "2.1.245" }],
          })
        );
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("pypi.org/pypi/mistral-vibe/json")
      ) {
        respond(null, JSON.stringify({ info: { version: "1.2.3" } }));
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("code.kimi.com/kimi-code/latest")
      ) {
        respond(null, "0.39.1\n");
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("cursor.com/install")
      ) {
        respond(
          null,
          'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.08.22-abc1234/darwin/arm64/agent-cli-package.tar.gz"\n'
        );
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("downloads.claude.ai/claude-code-releases/latest")
      ) {
        respond(null, "2.1.251\n");
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("downloads.claude.ai/claude-code-releases/stable")
      ) {
        respond(null, "2.1.236\n");
        return;
      }
      if (
        file === "curl" &&
        typeof urlArg === "string" &&
        urlArg.includes("api.github.com/repos/aaif-goose/goose/releases/latest")
      ) {
        respond(null, JSON.stringify({ tag_name: "v1.48.0" }));
        return;
      }
      if (file === "npm" && args.includes("@moonshot-ai/kimi-code")) {
        respond(null, JSON.stringify("9.9.9"));
        return;
      }
      respond(new Error(`unexpected ${file} ${args.join(" ")}`), "");
    }
  )
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, execFile: execFileMock },
    execFile: execFileMock,
  };
});

import {
  clearLatestVersionCache,
  fetchLatestVersion,
  parseBrewInfoVersion,
  readClaudeAutoUpdatesChannel,
} from "../../../../../src/main/services/agents/lifecycle/latest.ts";
import {
  brewPackageTokenFromBinPath,
  resolveBrewQueryName,
} from "../../../../../src/main/services/agents/lifecycle/plan/brew-token.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";
import { resolveUpdateMode } from "../../../../../src/main/services/agents/lifecycle/specs/types.ts";

afterEach(() => {
  clearLatestVersionCache();
  execFileMock.mockClear();
});

function brewBinSymlinkToCask(token: string): {
  binPath: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "pier-brew-token-"));
  const caskDir = join(root, "Caskroom", token, "2.1.222");
  mkdirSync(caskDir, { recursive: true });
  const target = join(caskDir, "claude");
  writeFileSync(target, "");
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, "claude");
  symlinkSync(target, binPath);
  return {
    binPath,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("parseBrewInfoVersion", () => {
  it("reads formula stable version", () => {
    expect(
      parseBrewInfoVersion(
        JSON.stringify({
          formulae: [{ versions: { stable: "1.18.14" } }],
          casks: [],
        })
      )
    ).toBe("1.18.14");
  });

  it("reads cask version when formulae empty (claude-code / copilot-cli)", () => {
    expect(
      parseBrewInfoVersion(
        JSON.stringify({
          formulae: [],
          casks: [{ version: "2.1.222" }],
        })
      )
    ).toBe("2.1.222");
  });

  it("prefers formula over cask when both present", () => {
    expect(
      parseBrewInfoVersion(
        JSON.stringify({
          formulae: [{ versions: { stable: "1.0.0" } }],
          casks: [{ version: "9.9.9" }],
        })
      )
    ).toBe("1.0.0");
  });

  it("returns null for empty brew json", () => {
    expect(
      parseBrewInfoVersion(JSON.stringify({ formulae: [], casks: [] }))
    ).toBeNull();
  });
});

describe("resolveBrewQueryName", () => {
  it("uses the installed cask variant (claude-code@latest ≠ claude-code)", () => {
    expect(
      resolveBrewQueryName({ formula: "claude-code" }, "claude-code@latest")
    ).toBe("claude-code@latest");
    expect(
      resolveBrewQueryName({ formula: "claude-code" }, "claude-code")
    ).toBe("claude-code");
    expect(resolveBrewQueryName({ formula: "claude-code" }, null)).toBe(
      "claude-code"
    );
  });

  it("keeps tap-qualified name when Cellar reports the bare formula", () => {
    expect(
      resolveBrewQueryName(
        { formula: "opencode", tap: "anomalyco/tap" },
        "opencode"
      )
    ).toBe("anomalyco/tap/opencode");
  });
});

describe("fetchLatestVersion brew remote API", () => {
  it("queries formulae.brew.sh for claude-code@latest (not stale brew info)", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("claude"),
      {},
      {
        defaultBinPath:
          "/opt/homebrew/Caskroom/claude-code@latest/2.1.222/claude",
        installSource: "brew",
      }
    );
    expect(latest).toBe("2.1.251");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "formulae.brew.sh/api/cask/claude-code%40latest.json"
        ),
      ])
    );
    expect(execFileMock.mock.calls.map((call) => call[0])).not.toContain(
      "brew"
    );
  });

  it("queries formulae.brew.sh stable cask when claude-code is installed", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("claude"),
      {},
      {
        defaultBinPath: "/opt/homebrew/Caskroom/claude-code/2.1.220/claude",
        installSource: "brew",
      }
    );
    expect(latest).toBe("2.1.236");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining("formulae.brew.sh/api/cask/claude-code.json"),
      ])
    );
  });

  it("resolves brew bin symlink via realpath to the installed @latest cask", async () => {
    const { binPath, cleanup } = brewBinSymlinkToCask("claude-code@latest");
    try {
      expect(brewPackageTokenFromBinPath(binPath)).toBe("claude-code@latest");
      const latest = await fetchLatestVersion(
        getAgentLifecycleSpec("claude"),
        {},
        {
          defaultBinPath: binPath,
          installSource: "brew",
        }
      );
      expect(latest).toBe("2.1.251");
    } finally {
      cleanup();
    }
  });

  it("does not call brew when core formulae.brew.sh misses", async () => {
    const originalImpl = execFileMock.getMockImplementation();
    execFileMock.mockImplementation(
      (
        file: string,
        args: readonly string[],
        options:
          | ((err: Error | null, stdout: string, stderr: string) => void)
          | object,
        callback?: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        const cb = typeof options === "function" ? options : callback;
        if (file === "curl") {
          cb?.(
            new Error("curl: (22) The requested URL returned error: 404"),
            "",
            ""
          );
          return;
        }
        if (file === "brew") {
          cb?.(
            null,
            JSON.stringify({
              formulae: [],
              casks: [{ version: "9.9.9" }],
            }),
            ""
          );
          return;
        }
        cb?.(new Error(`unexpected ${file} ${args.join(" ")}`), "", "");
      }
    );
    try {
      const latest = await fetchLatestVersion(
        getAgentLifecycleSpec("claude"),
        {},
        {
          defaultBinPath: "/opt/homebrew/Caskroom/claude-code/2.1.220/claude",
          installSource: "brew",
        }
      );
      expect(latest).toBeNull();
      expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
      expect(execFileMock.mock.calls.map((call) => call[0])).not.toContain(
        "brew"
      );
    } finally {
      if (originalImpl) {
        execFileMock.mockImplementation(originalImpl);
      }
    }
  });

  it("falls back to local brew info for tap-qualified opencode", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("opencode"),
      {},
      {
        defaultBinPath: "/opt/homebrew/Cellar/opencode/1.18.14/bin/opencode",
        installSource: "brew",
      }
    );
    expect(latest).toBe("1.18.14");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("brew");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining(["anomalyco/tap/opencode"])
    );
  });
});

describe("fetchLatestVersion force cache bypass", () => {
  it("re-fetches when force is true even within TTL", async () => {
    const opts = {
      defaultBinPath:
        "/opt/homebrew/Caskroom/claude-code@latest/2.1.222/claude",
      installSource: "brew" as const,
    };
    expect(
      await fetchLatestVersion(getAgentLifecycleSpec("claude"), {}, opts)
    ).toBe("2.1.251");
    const firstCalls = execFileMock.mock.calls.length;
    expect(
      await fetchLatestVersion(getAgentLifecycleSpec("claude"), {}, opts)
    ).toBe("2.1.251");
    expect(execFileMock.mock.calls.length).toBe(firstCalls);
    expect(
      await fetchLatestVersion(
        getAgentLifecycleSpec("claude"),
        {},
        {
          ...opts,
          force: true,
        }
      )
    ).toBe("2.1.251");
    expect(execFileMock.mock.calls.length).toBeGreaterThan(firstCalls);
  });
});

describe("agent latest probe channels", () => {
  it("claude is versioned with brew cask + npm package for latest", () => {
    const spec = getAgentLifecycleSpec("claude");
    expect(resolveUpdateMode(spec)).toBe("versioned");
    const brew = spec.install.find((c) => c.kind === "brew");
    expect(brew?.kind === "brew" && brew.cask).toBe(true);
    expect(spec.npmPackageForLatest).toBe("@anthropic-ai/claude-code");
  });

  it("kimi is versioned with native latestProbe + npm (no uv channel)", () => {
    const spec = getAgentLifecycleSpec("kimi");
    expect(resolveUpdateMode(spec)).toBe("versioned");
    expect(spec.latestProbe).toEqual({
      kind: "http-text",
      url: "https://code.kimi.com/kimi-code/latest",
    });
    expect(spec.install.some((c) => c.kind === "uv")).toBe(false);
    expect(spec.update.some((c) => c.kind === "uv-upgrade")).toBe(false);
    expect(spec.npmPackageForLatest).toBe("@moonshot-ai/kimi-code");
  });

  it("mistral-vibe is versioned via PyPI (uv/pipx, no npm/brew)", () => {
    const spec = getAgentLifecycleSpec("mistral-vibe");
    expect(resolveUpdateMode(spec)).toBe("versioned");
    expect(spec.npmPackageForLatest).toBeUndefined();
    expect(spec.install.some((c) => c.kind === "brew")).toBe(false);
    expect(
      spec.install.some((c) => c.kind === "uv" && c.package === "mistral-vibe")
    ).toBe(true);
    expect(
      spec.install.some(
        (c) => c.kind === "pipx" && c.package === "mistral-vibe"
      )
    ).toBe(true);
  });
});

describe("fetchLatestVersion pypi", () => {
  it("queries PyPI for uv-sourced mistral-vibe", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("mistral-vibe"),
      {},
      { installSource: "uv" }
    );
    expect(latest).toBe("1.2.3");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining("pypi.org/pypi/mistral-vibe/json"),
      ])
    );
  });

  it("queries PyPI for pipx-sourced mistral-vibe (same index as uv)", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("mistral-vibe"),
      {},
      { installSource: "pipx" }
    );
    expect(latest).toBe("1.2.3");
  });
});

describe("fetchLatestVersion http latestProbe", () => {
  it("reads Cursor latest from the official install script", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("cursor"),
      {},
      { installSource: "path" }
    );
    expect(latest).toBe("2026.08.22-abc1234");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
    expect(execFileMock.mock.calls.map((call) => call[0])).not.toContain("npm");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([expect.stringContaining("cursor.com/install")])
    );
  });

  it("reads Kimi Code native latest for path installs, not PyPI kimi-cli", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("kimi"),
      {},
      {
        defaultBinPath: "/Users/x/.kimi-code/bin/kimi",
        installSource: "path",
      }
    );
    expect(latest).toBe("0.39.1");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
    expect(execFileMock.mock.calls.map((call) => call[0])).not.toContain("npm");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining("code.kimi.com/kimi-code/latest"),
      ])
    );
    expect(execFileMock.mock.calls.map((call) => call[1])).not.toContainEqual(
      expect.arrayContaining([
        expect.stringContaining("pypi.org/pypi/kimi-cli/json"),
      ])
    );
  });

  it("reads Claude native latest and never falls back to npm", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("claude"),
      {},
      { installSource: "path" }
    );
    expect(latest).toBe("2.1.251");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
    expect(execFileMock.mock.calls.map((call) => call[0])).not.toContain("npm");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "downloads.claude.ai/claude-code-releases/latest"
        ),
      ])
    );
  });

  it("reads Claude stable channel when autoUpdatesChannel is stable", async () => {
    const home = mkdtempSync(join(tmpdir(), "pier-claude-settings-"));
    try {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(
        join(home, ".claude", "settings.json"),
        JSON.stringify({ autoUpdatesChannel: "stable" })
      );
      expect(await readClaudeAutoUpdatesChannel({ homeDir: home })).toBe(
        "stable"
      );
      const latest = await fetchLatestVersion(
        getAgentLifecycleSpec("claude"),
        {},
        { installSource: "path", homeDir: home }
      );
      expect(latest).toBe("2.1.236");
      expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "downloads.claude.ai/claude-code-releases/stable"
          ),
        ])
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads Claude stable channel from CLAUDE_CONFIG_DIR, not ~/.claude", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "pier-claude-config-"));
    const ignoredHome = mkdtempSync(join(tmpdir(), "pier-claude-home-"));
    try {
      writeFileSync(
        join(configDir, "settings.json"),
        JSON.stringify({ autoUpdatesChannel: "stable" })
      );
      mkdirSync(join(ignoredHome, ".claude"), { recursive: true });
      writeFileSync(
        join(ignoredHome, ".claude", "settings.json"),
        JSON.stringify({ autoUpdatesChannel: "latest" })
      );
      expect(
        await readClaudeAutoUpdatesChannel({
          env: { CLAUDE_CONFIG_DIR: configDir },
          homeDir: ignoredHome,
        })
      ).toBe("stable");
      const latest = await fetchLatestVersion(
        getAgentLifecycleSpec("claude"),
        { CLAUDE_CONFIG_DIR: configDir },
        { installSource: "path", homeDir: ignoredHome }
      );
      expect(latest).toBe("2.1.236");
      expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "downloads.claude.ai/claude-code-releases/stable"
          ),
        ])
      );
    } finally {
      rmSync(configDir, { recursive: true, force: true });
      rmSync(ignoredHome, { recursive: true, force: true });
    }
  });

  it("reads Goose path latest from GitHub Releases", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("goose"),
      {},
      { installSource: "path" }
    );
    expect(latest).toBe("1.48.0");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "api.github.com/repos/aaif-goose/goose/releases/latest"
        ),
      ])
    );
  });
});
