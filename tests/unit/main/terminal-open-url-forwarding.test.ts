import { describe, expect, it, vi } from "vitest";
import {
  classifyTerminalOpenUrlForMain,
  handleTerminalOpenUrl,
} from "../../../src/main/ipc/terminal-open-url-forwarding.ts";

describe("classifyTerminalOpenUrlForMain", () => {
  it("treats http(s)/mailto as remote", () => {
    expect(classifyTerminalOpenUrlForMain("https://x.test")).toBe("remote");
    expect(classifyTerminalOpenUrlForMain("http://x.test")).toBe("remote");
    expect(classifyTerminalOpenUrlForMain("mailto:a@b.c")).toBe("remote");
  });

  it("treats file and bare paths as filesystem candidates", () => {
    expect(classifyTerminalOpenUrlForMain("file:///tmp/a")).toBe("filesystem");
    expect(classifyTerminalOpenUrlForMain("/tmp/a")).toBe("filesystem");
    expect(classifyTerminalOpenUrlForMain("docs/a.md")).toBe("filesystem");
  });

  it("keeps unknown schemes inside the app", () => {
    expect(classifyTerminalOpenUrlForMain("local://notes.md")).toBe(
      "app-internal"
    );
    expect(classifyTerminalOpenUrlForMain("zed://file/repo/a.ts")).toBe(
      "app-internal"
    );
  });
});

describe("handleTerminalOpenUrl", () => {
  it("opens remote via openExternal and does not broadcast", async () => {
    const openExternal = vi.fn(async () => undefined);
    const broadcast = vi.fn();
    await handleTerminalOpenUrl({
      broadcast,
      kind: "text",
      openExternal,
      panelId: "t1",
      url: "https://example.com",
      windowId: 7,
    });
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("broadcasts filesystem candidates", async () => {
    const openExternal = vi.fn(async () => undefined);
    const broadcast = vi.fn();
    await handleTerminalOpenUrl({
      broadcast,
      kind: "text",
      openExternal,
      panelId: "t1",
      url: "/repo/a.md",
      windowId: 7,
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith({
      kind: "text",
      panelId: "t1",
      url: "/repo/a.md",
    });
  });

  it("never opens unknown schemes externally", async () => {
    const openExternal = vi.fn(async () => undefined);
    const broadcast = vi.fn();
    await handleTerminalOpenUrl({
      broadcast,
      kind: "text",
      openExternal,
      panelId: "t1",
      url: "local://drag-tab-cross-window-plan.md",
      windowId: 7,
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith({
      kind: "text",
      panelId: "t1",
      url: "local://drag-tab-cross-window-plan.md",
    });
  });
});
