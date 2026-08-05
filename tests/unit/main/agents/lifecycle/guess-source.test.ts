import { describe, expect, it } from "vitest";
import { guessInstallSource } from "../../../../../src/main/services/agents/lifecycle/sources/path-enum.ts";

describe("guessInstallSource", () => {
  it("does not treat bare Homebrew bin prefix as brew when not a real package", () => {
    // Use a non-existent path so realpath cannot resolve into Cellar/Caskroom.
    // npm globals under Homebrew Node often look like /opt/homebrew/bin/<name>
    // without being a brew formula/cask.
    expect(
      guessInstallSource("/opt/homebrew/bin/pier-lifecycle-not-a-package")
    ).toBe("path");
    expect(
      guessInstallSource("/usr/local/bin/pier-lifecycle-not-a-package")
    ).toBe("path");
  });

  it("detects brew formula Cellar and cask Caskroom paths", () => {
    expect(
      guessInstallSource("/opt/homebrew/Cellar/block-goose-cli/1.0.0/bin/goose")
    ).toBe("brew");
    expect(
      guessInstallSource("/opt/homebrew/Caskroom/claude-code/2.0.0/claude")
    ).toBe("brew");
  });

  it("detects npm global via node_modules real path shape", () => {
    expect(
      guessInstallSource(
        "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js"
      )
    ).toBe("npm");
  });

  it("detects bun global installs before generic node_modules", () => {
    expect(
      guessInstallSource(
        "/Users/x/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js"
      )
    ).toBe("bun");
  });

  it("detects winget package paths", () => {
    expect(
      guessInstallSource(
        "C:/Users/x/AppData/Local/Microsoft/WinGet/Packages/Some.Package/bin/cli.exe"
      )
    ).toBe("winget");
  });

  it("detects nvm and native path installs", () => {
    expect(
      guessInstallSource("/Users/x/.nvm/versions/node/v22.0.0/bin/claude")
    ).toBe("nvm");
    expect(guessInstallSource("/Users/x/.local/bin/claude")).toBe("path");
  });
});
