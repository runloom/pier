import type {
  TerminalComposerMaterializeResult,
  TerminalComposerPathsResult,
  TerminalComposerPickResult,
} from "@shared/contracts/terminal.ts";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ClipboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ComposerAttachment,
  MAX_COMPOSER_SEND_TEXT_LENGTH,
} from "@/panel-kits/terminal/terminal-composer-attachments-model.ts";
import {
  resetTerminalComposerAttachmentsForTests,
  useTerminalComposerAttachments,
} from "@/panel-kits/terminal/use-terminal-composer-attachments.ts";

const pickComposerFiles = vi.fn<() => Promise<TerminalComposerPickResult>>();
const resolveComposerPaths =
  vi.fn<(paths: string[]) => Promise<TerminalComposerPathsResult>>();
const materializeComposerClipboardImage =
  vi.fn<() => Promise<TerminalComposerMaterializeResult>>();
const materializeComposerImageBytes =
  vi.fn<
    (data: {
      bytes: number[];
      mime?: string;
      name?: string;
    }) => Promise<TerminalComposerMaterializeResult>
  >();

function installTerminalApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        materializeComposerClipboardImage,
        materializeComposerImageBytes,
        pickComposerFiles,
        resolveComposerPaths,
      },
    },
  });
}

function attachment(
  path: string,
  overrides: Partial<ComposerAttachment> = {}
): ComposerAttachment {
  const name = path.split("/").pop() ?? path;
  return {
    id: overrides.id ?? path,
    kind: overrides.kind ?? (path.endsWith(".png") ? "image" : "file"),
    name: overrides.name ?? name,
    path,
  };
}

function dtoFrom(path: string) {
  const att = attachment(path);
  return {
    id: att.id,
    kind: att.kind,
    name: att.name,
    path: att.path,
    ...(att.previewDataUrl ? { previewDataUrl: att.previewDataUrl } : {}),
  };
}

interface HookInput {
  disabled?: boolean;
  panelId?: string;
}

function setup(input: HookInput = {}) {
  const draftRef = { current: { cursor: 0, draft: "", selectionEnd: 0 } };
  const onDraftChange = vi.fn((draft: string, cursor?: number) => {
    draftRef.current = {
      cursor: cursor ?? draft.length,
      draft,
      selectionEnd: cursor ?? draft.length,
    };
  });
  const reportError = vi.fn();
  const getDraftAndCursor = vi.fn(() => ({ ...draftRef.current }));

  const hook = renderHook(() =>
    useTerminalComposerAttachments({
      disabled: input.disabled ?? false,
      getDraftAndCursor,
      onDraftChange,
      panelId: input.panelId ?? "panel-1",
      reportError,
    })
  );

  return {
    draftRef,
    getDraftAndCursor,
    hook,
    onDraftChange,
    reportError,
  };
}

beforeEach(() => {
  installTerminalApi();
  pickComposerFiles.mockReset();
  resolveComposerPaths.mockReset();
  materializeComposerClipboardImage.mockReset();
  materializeComposerImageBytes.mockReset();
  resetTerminalComposerAttachmentsForTests();
});

afterEach(() => {
  resetTerminalComposerAttachmentsForTests();
  Reflect.deleteProperty(window, "pier");
});

describe("useTerminalComposerAttachments", () => {
  it("dedupes by absolute path and does not insert a second token", async () => {
    const { draftRef, hook, onDraftChange } = setup();
    draftRef.current = { cursor: 0, draft: "分析", selectionEnd: 0 };

    pickComposerFiles
      .mockResolvedValueOnce({ ok: true, paths: ["/abs/a.png"] })
      .mockResolvedValueOnce({ ok: true, paths: ["/abs/a.png", "/abs/b.pdf"] });
    resolveComposerPaths.mockImplementation(async (paths) => ({
      attachments: paths.map(dtoFrom),
      failures: [],
    }));

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(1);
    });
    expect(hook.result.current.attachments[0]?.path).toBe("/abs/a.png");
    expect(onDraftChange).toHaveBeenCalled();
    const afterFirst = draftRef.current.draft;
    expect(afterFirst).toContain("[#1]");

    onDraftChange.mockClear();
    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(2);
    });

    expect(hook.result.current.attachments.map((item) => item.path)).toEqual([
      "/abs/a.png",
      "/abs/b.pdf",
    ]);
    expect(draftRef.current.draft.match(/\[#1\]/g)).toHaveLength(1);
    expect(draftRef.current.draft).toContain("[#2]");
    expect(onDraftChange).toHaveBeenCalledTimes(1);
  });

  it("removeAttachment rewrites draft tokens and renumbers", async () => {
    const { draftRef, hook, onDraftChange } = setup();
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/p/1.png", "/p/2.pdf", "/p/3.txt"],
    });
    resolveComposerPaths.mockImplementation(async (paths) => ({
      attachments: paths.map(dtoFrom),
      failures: [],
    }));

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(3);
    });

    draftRef.current = {
      cursor: 0,
      draft: "x [#1] y [#3] z [#2]",
      selectionEnd: 0,
    };
    onDraftChange.mockClear();

    const removeId = hook.result.current.attachments[1]!.id;
    act(() => {
      hook.result.current.removeAttachment(removeId);
    });

    expect(hook.result.current.attachments).toHaveLength(2);
    expect(hook.result.current.attachments.map((a) => a.path)).toEqual([
      "/p/1.png",
      "/p/3.txt",
    ]);
    expect(onDraftChange).toHaveBeenCalledWith(expect.stringMatching(/\[#1]/));
    const nextDraft = onDraftChange.mock.calls[0]![0] as string;
    expect(nextDraft).toMatch(/\[#1]/);
    expect(nextDraft).toMatch(/\[#2]/);
    expect(nextDraft).not.toMatch(/\[#3\]/);
  });

  it("buildPayloadOrReport reports invalid attachment refs", async () => {
    const { draftRef, hook, reportError } = setup();
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/only.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [dtoFrom("/only.png")],
      failures: [],
    });

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(1);
    });

    const payload =
      hook.result.current.buildPayloadOrReport("see [#0] and [#9]");
    expect(payload).toBeNull();
    expect(reportError).toHaveBeenCalledWith(
      "terminal.composer.invalidAttachmentRef",
      expect.stringContaining("[#0]")
    );
  });

  it("buildPayloadOrReport reports when expanded payload exceeds 64k", async () => {
    const { draftRef, hook, reportError } = setup();
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    const longPath = `/${"a".repeat(100)}.png`;
    pickComposerFiles.mockResolvedValue({ ok: true, paths: [longPath] });
    resolveComposerPaths.mockResolvedValue({
      attachments: [dtoFrom(longPath)],
      failures: [],
    });

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(1);
    });

    const hugeBody = "x".repeat(MAX_COMPOSER_SEND_TEXT_LENGTH);
    const payload = hook.result.current.buildPayloadOrReport(hugeBody);
    expect(payload).toBeNull();
    expect(reportError).toHaveBeenCalledWith(
      "terminal.composer.sendTooLong",
      expect.any(String)
    );
  });

  it("buildPayloadOrReport returns assembled text for valid input", async () => {
    const { draftRef, hook, reportError } = setup();
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/shot.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [dtoFrom("/shot.png")],
      failures: [],
    });

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(1);
    });

    const payload = hook.result.current.buildPayloadOrReport("分析 [#1]");
    expect(payload).toBe("/shot.png\n分析 /shot.png");
    expect(reportError).not.toHaveBeenCalled();
    expect(hook.result.current.canSendWithDraft("分析 [#1]")).toBe(true);
    expect(hook.result.current.canSendWithDraft("   ")).toBe(true);
    expect(hook.result.current.canSendWithDraft("")).toBe(true);
  });

  it("clearAll empties attachments and module map", async () => {
    const { draftRef, hook } = setup({ panelId: "p-clear" });
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/a.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [dtoFrom("/a.png")],
      failures: [],
    });

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(1);
    });

    act(() => {
      hook.result.current.clearAll();
    });
    expect(hook.result.current.attachments).toEqual([]);

    const restored = renderHook(() =>
      useTerminalComposerAttachments({
        disabled: false,
        getDraftAndCursor: () => ({ cursor: 0, draft: "", selectionEnd: 0 }),
        onDraftChange: vi.fn(),
        panelId: "p-clear",
        reportError: vi.fn(),
      })
    );
    expect(restored.result.current.attachments).toEqual([]);
    restored.unmount();
  });

  it("hydrateFromMaps restores attachments after remount", async () => {
    const { draftRef, hook } = setup({ panelId: "p-hydrate" });
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/keep.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [dtoFrom("/keep.png")],
      failures: [],
    });

    await act(async () => {
      hook.result.current.pickFiles();
    });
    await waitFor(() => {
      expect(hook.result.current.attachments).toHaveLength(1);
    });
    hook.unmount();

    const next = renderHook(() =>
      useTerminalComposerAttachments({
        disabled: false,
        getDraftAndCursor: () => ({ cursor: 0, draft: "", selectionEnd: 0 }),
        onDraftChange: vi.fn(),
        panelId: "p-hydrate",
        reportError: vi.fn(),
      })
    );
    expect(next.result.current.attachments).toHaveLength(1);
    expect(next.result.current.attachments[0]?.path).toBe("/keep.png");

    act(() => {
      next.result.current.hydrateFromMaps();
    });
    expect(next.result.current.attachments[0]?.path).toBe("/keep.png");
    next.unmount();
  });
});

describe("paste file + text", () => {
  it("keeps [#n] tokens when plain text follows file paste", async () => {
    resolveComposerPaths.mockResolvedValue({
      attachments: [dtoFrom("/tmp/shot.png")],
      failures: [],
    });

    const { draftRef, hook } = setup({ panelId: "p-paste" });
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(file, "path", { value: "/tmp/shot.png" });

    const clipboardData = {
      files: {
        length: 1,
        0: file,
        item: (i: number) => (i === 0 ? file : null),
        *[Symbol.iterator]() {
          yield file;
        },
      } as unknown as FileList,
      getData: (type: string) => (type === "text/plain" ? " 说明" : ""),
      items: [{ kind: "file", type: "image/png" }],
    };

    const event = {
      clipboardData,
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    await act(async () => {
      hook.result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(draftRef.current.draft).toContain("[#1]");
      expect(draftRef.current.draft).toContain("说明");
    });
  });
});

describe("paste plain after failed re-attach", () => {
  it("does not wipe later typing when re-paste fails or dedupes", async () => {
    // First attach succeeds and inserts [#1]
    resolveComposerPaths.mockResolvedValueOnce({
      attachments: [dtoFrom("/tmp/shot.png")],
      failures: [],
    });
    const { draftRef, hook, onDraftChange } = setup({ panelId: "p-stale" });
    draftRef.current = { cursor: 0, draft: "", selectionEnd: 0 };

    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(file, "path", { value: "/tmp/shot.png" });

    const mkEvent = (plain: string) =>
      ({
        clipboardData: {
          files: {
            length: 1,
            0: file,
            item: (i: number) => (i === 0 ? file : null),
            *[Symbol.iterator]() {
              yield file;
            },
          } as unknown as FileList,
          getData: (type: string) => (type === "text/plain" ? plain : ""),
          items: [{ kind: "file", type: "image/png" }],
        },
        preventDefault: vi.fn(),
      }) as unknown as ClipboardEvent;

    await act(async () => {
      hook.result.current.onPaste(mkEvent(""));
    });
    await waitFor(() => {
      expect(draftRef.current.draft).toContain("[#1]");
    });

    // User types more after attach
    const typed = `${draftRef.current.draft} later`;
    draftRef.current = {
      cursor: typed.length,
      draft: typed,
      selectionEnd: typed.length,
    };
    onDraftChange.mockClear();

    // Re-paste same path (dedupe) with plain text — must not resurrect stale draft
    resolveComposerPaths.mockResolvedValueOnce({
      attachments: [dtoFrom("/tmp/shot.png")],
      failures: [],
    });
    await act(async () => {
      hook.result.current.onPaste(mkEvent(" extra"));
    });
    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalled();
    });
    const lastDraft = onDraftChange.mock.calls.at(-1)?.[0] as string;
    expect(lastDraft).toContain("later");
    expect(lastDraft).toContain("extra");
  });
});
