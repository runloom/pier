import { describe, expect, it } from "vitest";
import {
  parseCursorInstallScriptVersion,
  parseGithubLatestReleaseVersion,
  parseHttpTextVersion,
  resolveHttpTextProbeUrl,
} from "../../../../../src/main/services/agents/lifecycle/latest-http.ts";

describe("parseCursorInstallScriptVersion", () => {
  it("reads the lab version from DOWNLOAD_URL", () => {
    const body = `
DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.08.11-e8db854/\${OS}/\${ARCH}/agent-cli-package.tar.gz"
FINAL_DIR="$HOME/.local/share/cursor-agent/versions/2026.08.11-e8db854"
`;
    expect(parseCursorInstallScriptVersion(body)).toBe("2026.08.11-e8db854");
  });

  it("returns null when the script shape changes", () => {
    expect(parseCursorInstallScriptVersion("echo hello")).toBeNull();
  });
});

describe("parseHttpTextVersion", () => {
  it("reads a plain Claude latest file", () => {
    expect(parseHttpTextVersion("2.1.241\n")).toBe("2.1.241");
  });

  it("rejects HTML error pages", () => {
    expect(
      parseHttpTextVersion("<!DOCTYPE html><html><body>not a version</body>")
    ).toBeNull();
  });
});

describe("parseGithubLatestReleaseVersion", () => {
  it("strips leading v from tag_name", () => {
    expect(
      parseGithubLatestReleaseVersion(JSON.stringify({ tag_name: "v1.48.0" }))
    ).toBe("1.48.0");
  });

  it("returns null for malformed json", () => {
    expect(parseGithubLatestReleaseVersion("not-json")).toBeNull();
  });
});

describe("resolveHttpTextProbeUrl", () => {
  const probe = {
    kind: "http-text" as const,
    url: "https://downloads.claude.ai/claude-code-releases/latest",
    stableUrl: "https://downloads.claude.ai/claude-code-releases/stable",
  };

  it("uses stableUrl when channel is stable", () => {
    expect(resolveHttpTextProbeUrl(probe, "stable")).toBe(probe.stableUrl);
  });

  it("uses latest url by default", () => {
    expect(resolveHttpTextProbeUrl(probe, "latest")).toBe(probe.url);
    expect(resolveHttpTextProbeUrl(probe, null)).toBe(probe.url);
  });
});
