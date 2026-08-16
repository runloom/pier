import { describe, expect, it } from "vitest";
import { binaryPathFromLaunchSpec } from "../../../../src/main/services/lsp/resolve-command.ts";

describe("binaryPathFromLaunchSpec", () => {
  it("returns an absolute unix command as-is", () => {
    expect(
      binaryPathFromLaunchSpec({
        args: ["--stdio"],
        command: "/opt/homebrew/bin/gopls",
      })
    ).toBe("/opt/homebrew/bin/gopls");
  });

  it("extracts the quoted .cmd script from a cmd.exe launch", () => {
    expect(
      binaryPathFromLaunchSpec({
        args: ["/d", "/s", "/c", `"C:\\tools\\gopls.cmd" --version`],
        command: "C:\\Windows\\System32\\cmd.exe",
      })
    ).toBe("C:\\tools\\gopls.cmd");
  });

  it("does not treat cmd.exe itself as the language-server path", () => {
    expect(
      binaryPathFromLaunchSpec({
        args: ["/d", "/s", "/c"],
        command: "cmd.exe",
      })
    ).toBeNull();
  });
});
