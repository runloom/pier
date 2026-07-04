import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const builderConfig = readFileSync(
  join(process.cwd(), "electron-builder.yml"),
  "utf8"
);
const nativeAddonSource = readFileSync(
  join(process.cwd(), "src/main/ipc/terminal-native-addon.ts"),
  "utf8"
);

describe("native terminal packaging", () => {
  it("ships Ghostty resources beside the unpacked native addon", () => {
    expect(builderConfig).toContain("native/build/Release/**");
    expect(builderConfig).toContain("native/GhosttyResources/**");
    expect(
      existsSync(
        join(
          process.cwd(),
          "native/GhosttyResources/ghostty/shell-integration/zsh/ghostty-integration"
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        join(process.cwd(), "native/GhosttyResources/terminfo/78/xterm-ghostty")
      )
    ).toBe(true);
    expect(nativeAddonSource).toContain("GHOSTTY_RESOURCES_DIR");
    expect(nativeAddonSource).toContain('"GhosttyResources"');
    expect(nativeAddonSource).toContain('"ghostty"');
  });
});
