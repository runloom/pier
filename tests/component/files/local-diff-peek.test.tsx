import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  getDocument,
  markDocumentLoaded,
  markDocumentSaved,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { useFileChangeSurface } from "@plugins/builtin/files/renderer/git-changes/context.ts";
import { requestFileChange } from "@plugins/builtin/files/renderer/git-changes/requests.ts";
import { FileChangesSurface } from "@plugins/builtin/files/renderer/git-changes/surface.tsx";
import type { CompareRequest } from "@plugins/builtin/files/renderer/git-changes/types.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pier/ui/diff-view/excerpt/index.tsx", () => ({
  PierDiffExcerpt: ({
    fileDiff,
  }: {
    fileDiff: { additionLines: string[] };
  }) => <pre>{fileDiff.additionLines.join("")}</pre>,
}));
vi.mock("@plugins/builtin/files/renderer/git-changes/worker-client.ts", () => ({
  FileChangesWorker: class {
    compare(input: CompareRequest) {
      return Promise.resolve(compareFileContents(input));
    }
    cancel() {}
  },
}));
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  clearFilesDocumentStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function Markers() {
  const value = useFileChangeSurface();
  return (
    <>
      {value?.snapshot.ranges.map((range, index) => (
        <button
          data-git-change-id={range.id}
          key={range.id}
          onClick={() => value.openRange(range.id)}
          type="button"
        >
          change {index + 1}
        </button>
      ))}
    </>
  );
}
function setup() {
  const document = ensureDiskDocument({ root: "/repo", path: "a.md" });
  markDocumentLoaded(
    document.id,
    "one\nnew\nthree\nfour\nfive\nsix\nseven\nnewer\n"
  );
  const context = {
    git: {
      getStatus: async () => ({ files: [] }),
      getFileBaseline: async () => ({
        status: "ready",
        gitRoot: "/repo",
        path: "a.md",
        basePath: "a.md",
        headOid: "a",
        existsAtHead: true,
        contents: "one\nold\nthree\nfour\nfive\nsix\nseven\nolder\n",
      }),
      watch: () => () => undefined,
    },
    appearance: {
      current: () => ({
        typography: { codeFontFamily: "monospace", codeFontSize: "13px" },
        codeThemes: { light: "github-light", dark: "github-dark" },
        theme: "light",
      }),
      onDidChange: () => () => undefined,
    },
  } as unknown as RendererPluginContext;
  render(
    <TooltipProvider>
      <FileChangesSurface
        context={context}
        documentId={document.id}
        editorSessionId="peek-test"
        mode="preview"
        panelContext={undefined}
        t={(key, fallback) => fallback ?? key}
      >
        <Markers />
      </FileChangesSurface>
    </TooltipProvider>
  );
  return document;
}
describe("local change peek interaction", () => {
  it("keeps a pending next-change request while the document is recomputed", async () => {
    const doc = setup();
    const marker = await screen.findByRole("button", { name: "change 1" });
    const root = marker.closest(
      '[data-slot="file-changes-surface"]'
    ) as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 300, 200)
    );
    vi.spyOn(marker, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 20, 16, 22)
    );
    act(() =>
      updateDocumentContents(
        doc.id,
        `${getDocument(doc.id)?.currentContents ?? ""}\n`
      )
    );
    act(() => requestFileChange("peek-test", { kind: "next", keyboard: true }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeVisible());
  });
  it.each([
    "frame-first",
    "restoration-first",
  ])("keeps focus after a closing Radix dialog: %s", async (order) => {
    setup();
    await screen.findByRole("button", { name: "change 1" });
    // forceMount holds the real FocusScope during the closed animation state.
    // Its actual unmount timer then restores focus, just as CommandDialog does.
    const restore = vi.fn();
    function Palette({ mounted }: { mounted: boolean }) {
      return (
        <DialogPrimitive.Root modal={false} open={false}>
          <DialogPrimitive.Trigger>Palette origin</DialogPrimitive.Trigger>
          {mounted ? (
            <DialogPrimitive.Content
              data-slot="dialog-content"
              forceMount
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                screen.getByRole("button", { name: "Palette origin" }).focus();
                restore();
              }}
            >
              <DialogPrimitive.Title>Commands</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                Choose a command
              </DialogPrimitive.Description>
            </DialogPrimitive.Content>
          ) : null}
        </DialogPrimitive.Root>
      );
    }
    const palette = render(<Palette mounted={false} />);
    screen.getByRole("button", { name: "Palette origin" }).focus();
    palette.rerender(<Palette mounted />);
    act(() =>
      requestFileChange("peek-test", { kind: "current", keyboard: true })
    );
    await screen.findByRole("region", { name: "Change preview" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frames.push(callback);
        return frames.length;
      }
    );
    await act(async () => {
      palette.rerender(<Palette mounted={false} />);
      await Promise.resolve();
    });
    const paint = () =>
      act(() => {
        for (const frame of frames.splice(0)) frame(0);
      });
    if (order === "frame-first") paint();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    if (order === "restoration-first") paint();
    expect(restore).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("region", { name: "Change preview" })
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus();
  });
  it("enables full review after saving a draft-only change without closing the excerpt", async () => {
    const doc = setup();
    act(() => updateDocumentContents(doc.id, "draft-only\n"));
    const marker = await screen.findByRole("button", { name: "change 1" });
    fireEvent.click(marker);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save the file first" })
      ).toBeDisabled()
    );
    act(() => markDocumentSaved(doc.id, "draft-only\n"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open full review" })
      ).toBeEnabled()
    );
    expect(
      screen.getByRole("region", { name: "Change preview" })
    ).toBeVisible();
  });
  it("toggles one marker, replaces with another, and closes on body click", async () => {
    setup();
    const first = await screen.findByRole("button", { name: "change 1" });
    const second = await screen.findByRole("button", { name: "change 2" });
    fireEvent.click(first);
    await screen.findByRole("region", { name: "Change preview" });
    expect(screen.getByText("1 / 2")).toBeVisible();
    fireEvent.click(second);
    expect(screen.getByText("2 / 2")).toBeVisible();
    expect(
      screen.getAllByRole("region", { name: "Change preview" })
    ).toHaveLength(1);
    fireEvent.click(second);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Change preview" })
      ).toBeNull()
    );
    fireEvent.click(first);
    await screen.findByRole("region", { name: "Change preview" });
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Change preview" })
      ).toBeNull()
    );
  });
  it("closes an immutable excerpt as soon as current contents change", async () => {
    const doc = setup();
    fireEvent.click(await screen.findByRole("button", { name: "change 1" }));
    await screen.findByRole("region", { name: "Change preview" });
    act(() => updateDocumentContents(doc.id, "another draft\n"));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Change preview" })
      ).toBeNull()
    );
  });
  it("closes when a host dialog opens", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "change 1" }));
    await screen.findByRole("region", { name: "Change preview" });
    const dialog = document.createElement("div");
    dialog.dataset.slot = "dialog-content";
    document.body.append(dialog);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Change preview" })
      ).toBeNull()
    );
    dialog.remove();
  });
  it("keyboard invocation focuses an action; Escape restores the invoking control", async () => {
    setup();
    const first = await screen.findByRole("button", { name: "change 1" });
    first.focus();
    act(() =>
      requestFileChange("peek-test", { kind: "current", keyboard: true })
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus()
    );
    act(() => requestFileChange("peek-test", { kind: "next", keyboard: true }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus()
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Change preview" })
      ).toBeNull()
    );
    expect(first).toHaveFocus();
  });
});
