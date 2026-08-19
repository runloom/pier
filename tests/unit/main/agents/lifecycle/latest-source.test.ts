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
      const name = args.at(-1);
      const respond = (err: Error | null, stdout: string) => {
        cb?.(err, stdout, "");
      };
      if (file === "brew" && name === "claude-code@latest") {
        respond(
          null,
          JSON.stringify({
            formulae: [],
            casks: [{ version: "2.1.227" }],
          })
        );
        return;
      }
      if (file === "brew" && name === "claude-code") {
        respond(
          null,
          JSON.stringify({
            formulae: [],
            casks: [{ version: "2.1.220" }],
          })
        );
        return;
      }
      if (file === "brew" && name === "anomalyco/tap/opencode") {
        respond(
          null,
          JSON.stringify({
            formulae: [{ versions: { stable: "1.18.14" } }],
            casks: [],
          })
        );
        return;
      }
      if (
        file === "curl" &&
        args.some((arg) => arg.includes("pypi.org/pypi/mistral-vibe/json"))
      ) {
        respond(null, JSON.stringify({ info: { version: "1.2.3" } }));
        return;
      }
      if (
        file === "curl" &&
        args.some((arg) => arg.includes("pypi.org/pypi/kimi-cli/json"))
      ) {
        respond(null, JSON.stringify({ info: { version: "1.0.0" } }));
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

describe("fetchLatestVersion brew token", () => {
  it("queries claude-code@latest when that cask is installed", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("claude"),
      {},
      {
        defaultBinPath:
          "/opt/homebrew/Caskroom/claude-code@latest/2.1.222/claude",
        installSource: "brew",
      }
    );
    expect(latest).toBe("2.1.227");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining(["--cask", "claude-code@latest"])
    );
    expect(execFileMock.mock.calls.map((call) => call[1])).not.toContainEqual(
      expect.arrayContaining(["--cask", "claude-code"])
    );
  });

  it("queries spec claude-code when the stable cask is installed", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("claude"),
      {},
      {
        defaultBinPath: "/opt/homebrew/Caskroom/claude-code/2.1.220/claude",
        installSource: "brew",
      }
    );
    expect(latest).toBe("2.1.220");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining(["--cask", "claude-code"])
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
      expect(latest).toBe("2.1.227");
      expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
        expect.arrayContaining(["--cask", "claude-code@latest"])
      );
      expect(execFileMock.mock.calls.map((call) => call[1])).not.toContainEqual(
        expect.arrayContaining(["--cask", "claude-code"])
      );
    } finally {
      cleanup();
    }
  });

  it("queries tap-qualified opencode when Cellar reports the bare formula", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("opencode"),
      {},
      {
        defaultBinPath: "/opt/homebrew/Cellar/opencode/1.18.14/bin/opencode",
        installSource: "brew",
      }
    );
    expect(latest).toBe("1.18.14");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining(["anomalyco/tap/opencode"])
    );
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

  it("kimi is versioned with uv + npm (uv-upgrade preferred for uv source)", () => {
    const spec = getAgentLifecycleSpec("kimi");
    expect(resolveUpdateMode(spec)).toBe("versioned");
    expect(
      spec.install.some((c) => c.kind === "uv" && c.package === "kimi-cli")
    ).toBe(true);
    expect(spec.update.some((c) => c.kind === "uv-upgrade")).toBe(true);
    // Different product lines — must not compare uv installs to this npm name.
    expect(spec.npmPackageForLatest).toBe("@moonshot-ai/kimi-code");
    expect(spec.npmPackageForLatest).not.toBe("kimi-cli");
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

  it("queries PyPI for uv-sourced kimi and never calls npm", async () => {
    const latest = await fetchLatestVersion(
      getAgentLifecycleSpec("kimi"),
      {},
      { installSource: "uv" }
    );
    expect(latest).toBe("1.0.0");
    expect(execFileMock.mock.calls.map((call) => call[0])).toContain("curl");
    expect(execFileMock.mock.calls.map((call) => call[0])).not.toContain("npm");
    expect(execFileMock.mock.calls.map((call) => call[1])).toContainEqual(
      expect.arrayContaining([
        expect.stringContaining("pypi.org/pypi/kimi-cli/json"),
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
