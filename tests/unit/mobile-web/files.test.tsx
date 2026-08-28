/**
 * S3 文件页预览链路：file.readText 契约为裸 string（utf8 解码）。
 * 覆盖 string 成功路径（PREVIEW_MAX_CHARS 截断）、读取失败与二进制错误态。
 */

import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";
import { FilesPage } from "../../../apps/mobile-web/src/pages/files.tsx";

const { commandMock } = vi.hoisted(() => ({ commandMock: vi.fn() }));

vi.mock("../../../apps/mobile-web/src/lib/session.ts", () => ({
  getMobileClient: () => ({ command: commandMock }),
}));

const SNAPSHOT = {
  worktrees: [{ canonicalPath: "/repo", path: "/repo" }],
} as unknown as ControlSnapshotPayload;

/** file.list 固定返回单文件；readText 行为由用例注入。 */
function stubCommands(readText: () => Promise<unknown>): void {
  commandMock.mockReset();
  commandMock.mockImplementation((command: { type: string }) => {
    if (command.type === "file.readText") {
      return readText();
    }
    return Promise.resolve([
      { kind: "file", path: "notes.txt", root: "/repo" },
    ]);
  });
}

async function openNotes(): Promise<void> {
  render(<FilesPage />);
  await waitFor(() => {
    expect(screen.getByTestId("file-notes.txt")).toBeDefined();
  });
  fireEvent.click(screen.getByTestId("file-notes.txt"));
}

describe("FilesPage 预览（file.readText 裸 string 契约）", () => {
  beforeEach(() => {
    useMobileWebStore.setState({ snapshot: SNAPSHOT });
    stubCommands(() => Promise.resolve("default"));
  });

  afterEach(() => {
    cleanup();
    useMobileWebStore.setState({ snapshot: null });
  });

  it("readText 返回 string → 渲染预览并按 8192 字符截断", async () => {
    stubCommands(() => Promise.resolve("x".repeat(9000)));
    await openNotes();
    await waitFor(() => {
      expect(screen.getByTestId("file-preview")).toBeDefined();
    });
    expect(screen.getByTestId("file-preview").textContent).toHaveLength(8192);
    expect(
      screen.getByTestId("file-preview").textContent?.startsWith("xxxx")
    ).toBe(true);
    expect(screen.queryByTestId("file-preview-error")).toBeNull();
  });

  it("readText 拒绝 → 预览区明确错误态，不渲染预览内容", async () => {
    stubCommands(() => Promise.reject(new Error("EACCES: permission denied")));
    await openNotes();
    await waitFor(() => {
      expect(screen.getByTestId("file-preview-error")).toBeDefined();
    });
    expect(screen.getByTestId("file-preview-error").textContent).toContain(
      "EACCES"
    );
    expect(screen.queryByTestId("file-preview")).toBeNull();
  });

  it("readText 结果含 NUL（二进制）→ 二进制错误态文案", async () => {
    stubCommands(() => Promise.resolve("PK\u0000\u0000binary-ish"));
    await openNotes();
    await waitFor(() => {
      expect(screen.getByTestId("file-preview-error")).toBeDefined();
    });
    expect(screen.getByTestId("file-preview-error").textContent).toContain(
      "二进制"
    );
    expect(screen.queryByTestId("file-preview")).toBeNull();
  });
});
