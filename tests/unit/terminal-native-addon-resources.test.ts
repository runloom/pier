import { describe, expect, it } from "vitest";
import { ghosttyResourcesDirFromAddonPath } from "../../src/main/ipc/terminal-native-addon.ts";

describe("ghosttyResourcesDirFromAddonPath", () => {
  it("resolves resources beside native/ in dev (repo checkout)", () => {
    expect(
      ghosttyResourcesDirFromAddonPath(
        "/Users/dev/pier/native/build/Release/ghostty_native.node"
      )
    ).toBe("/Users/dev/pier/native/GhosttyResources/ghostty");
  });

  it("rewrites app.asar to app.asar.unpacked in packaged builds", () => {
    // 打包后 require.resolve 返回 asar 虚拟路径；Ghostty 原生代码和子进程 shell
    // 走真实文件系统读不了 asar，必须指到 asarUnpack 的物理目录。
    expect(
      ghosttyResourcesDirFromAddonPath(
        "/Applications/Pier.app/Contents/Resources/app.asar/native/build/Release/ghostty_native.node"
      )
    ).toBe(
      "/Applications/Pier.app/Contents/Resources/app.asar.unpacked/native/GhosttyResources/ghostty"
    );
  });

  it("does not rewrite paths that merely contain app.asar as a prefix", () => {
    expect(
      ghosttyResourcesDirFromAddonPath(
        "/Users/dev/app.asar-tools/native/build/Release/ghostty_native.node"
      )
    ).toBe("/Users/dev/app.asar-tools/native/GhosttyResources/ghostty");
  });
});
