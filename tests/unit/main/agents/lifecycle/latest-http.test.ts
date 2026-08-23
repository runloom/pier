import { describe, expect, it } from "vitest";
import {
  parseCursorInstallScriptVersion,
  parseHttpTextVersion,
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
