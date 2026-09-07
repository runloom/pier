import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeTerminalProcesses } from "@main/ipc/terminal/process/registry.ts";
import { createHostTerminalBackend } from "@main/services/runtime-control/host-backend.ts";
import { createTerminalDraftStore } from "@main/state/terminal-drafts/store.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendText = vi.fn(() => true);
const sendKeyPress = vi.fn(() => true);
const { needsUser } = vi.hoisted(() => ({
  needsUser: vi.fn(() => false),
}));
let dir: string;
let drafts: ReturnType<typeof createTerminalDraftStore>;

vi.mock("@main/state/terminal-drafts/index.ts", () => ({
  terminalDraftStore: () => drafts,
}));
vi.mock("@main/ipc/terminal/window-scope.ts", () => ({
  windowRecordIdFor: () => "record-1",
}));
vi.mock("@main/ipc/terminal/drafts/broadcast.ts", () => ({
  refreshTerminalDraft: () => drafts.read("record-1", "p1"),
}));
vi.mock("@main/ipc/terminal/drafts/approval.ts", () => ({
  terminalInputNeedsUser: () => needsUser(),
}));

vi.mock("../../../../src/main/ipc/terminal/index.ts", () => ({
  getTerminalAddon: () => ({
    sendText,
    sendKeyPress,
    readViewportText: () => "ok",
    closeTerminal: () => true,
  }),
}));

vi.mock("../../../../src/main/windows/identity.ts", () => ({
  findAppWindowByInternalId: () => ({
    id: 1,
    isDestroyed: () => false,
  }),
  findAppWindowForActivityWindowId: () => ({
    id: 1,
    isDestroyed: () => false,
  }),
  findAppWindowByElectronId: () => ({ id: 1, isDestroyed: () => false }),
}));

vi.mock("../../../../src/main/ipc/terminal/panel-id.ts", () => ({
  toNativePanelKey: (_win: unknown, panelId: string) => `1::${panelId}`,
}));

describe("host backend turn submit", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pier-host-turn-"));
    drafts = createTerminalDraftStore(join(dir, "drafts.json"));
    const process = nativeTerminalProcesses.begin("1::p1");
    nativeTerminalProcesses.created(process);
    sendText.mockClear();
    sendKeyPress.mockClear();
    needsUser.mockReset();
    needsUser.mockReturnValue(false);
  });
  afterEach(async () => {
    await drafts.flush();
    rmSync(dir, { recursive: true, force: true });
  });

  it("strips one trailing newline when submit is explicit", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    const ok = await backend.sendText("p1", "hello\n\nworld\n", true);
    expect(ok).toBe(true);
    expect(sendText).toHaveBeenCalledWith("1::p1", "hello\n\nworld");
    expect(sendKeyPress).toHaveBeenCalledWith("1::p1", 0x24, 0, "\r");
  });

  it("pastes body then Return when text ends with newline", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    const ok = await backend.sendText("p1", "hello\n");
    expect(ok).toBe(true);
    expect(sendText).toHaveBeenCalledWith("1::p1", "hello");
    expect(sendKeyPress).toHaveBeenCalledWith("1::p1", 0x24, 0, "\r");
    expect((await drafts.read("record-1", "p1")).text).toBe("");
  });

  it("does not inject Return when no trailing newline", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    await backend.sendText("p1", "partial");
    expect(sendText).toHaveBeenCalledWith("1::p1", "partial");
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(await drafts.read("record-1", "p1")).toMatchObject({
      text: "partial",
      status: "unconfirmed",
    });
  });

  it("does not require generation match without a native lifecycle id", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    const ok = await backend.sendText("p1", "hello\n", undefined, {
      agentId: "codex",
      closed: false,
      fact: "running",
      panelId: "p1",
      windowId: "win_1",
      runtime: { bootId: "b", runtimeId: "p1", generation: 99 },
    });
    expect(ok).toBe(true);
    expect(sendText).toHaveBeenCalledWith("1::p1", "hello");
  });

  it("finishes a thrown send as unconfirmed so the next send can proceed", async () => {
    needsUser.mockImplementation(() => {
      throw new Error("approval probe failed");
    });
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    await expect(backend.sendText("p1", "hello\n")).resolves.toBe(false);
    expect(await drafts.read("record-1", "p1")).toMatchObject({
      status: "unconfirmed",
      text: "hello",
    });
    needsUser.mockReturnValue(false);
    await expect(backend.sendText("p1", "retry\n")).resolves.toBe(true);
    expect(sendText).toHaveBeenCalledWith("1::p1", "retry");
  });
});
