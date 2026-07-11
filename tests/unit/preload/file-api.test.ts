import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: { invoke: invokeMock },
}));

import { filesApi } from "@preload/file-api.ts";

describe("filesApi", () => {
  beforeEach(() => invokeMock.mockReset());

  it("forwards the Save As operation id to the command boundary", async () => {
    const operationId = "00000000-0000-4000-8000-000000000001";
    invokeMock.mockResolvedValue({
      data: {
        canonicalPath: "notes.md",
        committed: true,
        durability: "confirmed",
        kind: "written",
        mode: 0o644,
        mtimeMs: 2,
        revision: "revision-2",
        size: 5,
      },
      ok: true,
      requestId: "request-1",
    });

    await filesApi.writeDocument({
      contents: "notes",
      eol: "lf",
      expected: { kind: "absent" },
      format: { bom: false, encoding: "utf8" },
      operationId,
      path: "notes.md",
      root: "/repo",
    });

    expect(invokeMock).toHaveBeenCalledWith(PIER.COMMAND_EXECUTE, {
      contents: "notes",
      eol: "lf",
      expected: { kind: "absent" },
      format: { bom: false, encoding: "utf8" },
      operationId,
      path: "notes.md",
      root: "/repo",
      type: "file.writeDocument",
    });
  });
});
