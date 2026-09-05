import {
  resetTooltipDismissStateForTests,
  TooltipProvider,
} from "@pier/ui/tooltip.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { FileChangePeekContent } from "@plugins/builtin/files/renderer/git-changes/peek-content.tsx";
import { FileChangesResource } from "@plugins/builtin/files/renderer/git-changes/resource.ts";
import type { FileChangesSnapshot } from "@plugins/builtin/files/renderer/git-changes/types.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { useMarkdownPreviewPrefsStore } from "@plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import {
  markdownRuntime,
  paginateMarkdownDocument,
} from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pierre's virtualized Shadow DOM needs layout. The actual source rendering is
// covered by Electron E2E; this double consumes real comparison metadata.
vi.mock("@pier/ui/diff-view/excerpt/index.tsx", () => ({
  PierDiffExcerpt: ({
    fileDiff,
  }: {
    fileDiff: { additionLines: string[]; deletionLines: string[] };
  }) => (
    <pre>
      {fileDiff.deletionLines.join("")}
      {fileDiff.additionLines.join("")}
    </pre>
  ),
}));

beforeEach(() => {
  resetTooltipDismissStateForTests();
  vi.spyOn(markdownRuntime, "parse").mockImplementation(async (input) => {
    const document = parseMarkdownToIr(input.source);
    return {
      document,
      pagination: paginateMarkdownDocument(document),
      revision: input.revision,
      status: "parsed",
    };
  });
  useMarkdownPreviewPrefsStore.setState({
    fontScale: 1,
    measureMode: "comfortable",
    readingAppearance: "auto",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(
  before: string,
  after: string,
  mode: "preview" | "source" = "preview",
  overrides: Partial<RendererPluginContext> = {}
) {
  const context = {
    appearance: {
      current: () => ({
        typography: { codeFontFamily: "monospace", codeFontSize: "13px" },
        codeTheme: "github-light",
        codeThemes: { light: "github-light", dark: "github-dark" },
        theme: "light",
      }),
      onDidChange: () => () => undefined,
    },
    ...overrides,
  } as unknown as RendererPluginContext;
  const snapshot: FileChangesSnapshot = {
    ...compareFileContents({ before, after, path: "a.md", version: 1 }),
    baseline: before,
    contents: after,
    dirty: false,
    gitRoot: "/repo",
    headOid: "a",
    path: "a.md",
    status: "ready",
    version: 1,
  };
  return render(
    <TooltipProvider>
      <FileChangePeekContent
        context={context}
        framed={false}
        height={320}
        index={0}
        mode={mode}
        onClose={vi.fn()}
        onMove={vi.fn()}
        panelContext={undefined}
        resource={new FileChangesResource(context, "rendered-test")}
        snapshot={snapshot}
        t={(key, fallback) => fallback ?? key}
      />
    </TooltipProvider>
  );
}

describe("Markdown local change reading", () => {
  it("renders a changed heading and preserves removed words with their formatting", async () => {
    const { container } = setup(
      "# Keep **old** wording\n",
      "# Keep **new** wording\n"
    );
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Keep oldnew wording");
    expect(heading.querySelector("strong del")).toHaveTextContent("old");
    expect(heading.querySelector("strong ins")).toHaveTextContent("new");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("keeps a fully deleted list readable and its task boxes read-only", async () => {
    const { container } = setup(
      "# Guide\n\n- [x] Keep evidence\n- [ ] Review deletion\n",
      "# Guide\n"
    );
    const task = await screen.findByRole("checkbox", {
      name: "Completed task",
    });
    expect(task).toBeChecked();
    expect(task).toBeDisabled();
    expect(screen.getByText("Review deletion")).toBeVisible();
    expect(container.querySelector("ul")).toBeTruthy();
    expect(
      container.querySelector('[data-diff-kind="deleted"]')
    ).toHaveTextContent("Keep evidence");
  });

  it("switches to exact source and back without changing the comparison", async () => {
    const { container } = setup("# Old guide\n", "# New guide\n");
    await screen.findByRole("heading");
    expect(screen.getByRole("tabpanel", { name: "Preview" })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("tabpanel", { name: "Source" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Source" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(container.querySelector("pre")).toHaveTextContent("# Old guide");
    expect(container.querySelector("pre")).toHaveTextContent("# New guide");
    expect(screen.queryByRole("heading")).toBeNull();
    const sourceTab = screen.getByRole("tab", { name: "Source" });
    act(() => sourceTab.focus());
    fireEvent.keyDown(sourceTab, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus()
    );
    expect(await screen.findByRole("heading")).toBeVisible();
  });

  it("keeps source mode as a source excerpt", () => {
    const { container } = setup("# Old\n", "# New\n", "source");
    expect(container.querySelector("pre")).toHaveTextContent("# Old");
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
  });

  it("exposes a reference link target change even when the visible label is unchanged", async () => {
    setup(
      "Read [guide][g].\n\n[g]: https://old.example\n",
      "Read [guide][g].\n\n[g]: https://new.example\n"
    );
    const link = await screen.findByRole("link", { name: "guide" });
    expect(screen.queryByText("Link changes")).toBeNull();
    expect(screen.queryByText("https://old.example")).toBeNull();
    act(() => link.focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Link address changed");
    expect(within(tooltip).getByText("https://old.example")).toBeVisible();
    expect(within(tooltip).getByText("https://new.example")).toBeVisible();
  });

  it("does not resolve a removed relative link against the current file location", async () => {
    const { container } = setup("[Old](old.md)\n", "[New](new.md)\n");
    await screen.findByText("Old");
    expect(container.querySelector("del a")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(container.querySelector("ins a")).toHaveAttribute("href", "new.md");
  });

  it("disables historical links inside deleted formatting containers", async () => {
    const openInEditor = vi.fn();
    const openInstance = vi.fn();
    const { container } = setup(
      "Keep **[Legacy](old.md)** beside [Current](current.md).\n",
      "Keep beside [Current](current.md).\n",
      "preview",
      {
        files: { openInEditor } as unknown as RendererPluginContext["files"],
        panels: { openInstance } as unknown as RendererPluginContext["panels"],
      }
    );
    await screen.findByText("Legacy");
    const historical = container.querySelector("del strong a")!;
    expect(historical).toHaveAttribute("aria-disabled", "true");
    expect(historical).not.toHaveAttribute("href");
    fireEvent.click(historical);
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openInstance).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Current" })).toHaveAttribute(
      "href",
      "current.md"
    );
  });

  it.each([
    ["[Install](other.md#installation)", "Install", "other.md", "installation"],
    ["[Install](#%E5%AE%89%E8%A3%85)", "Install", "a.md", "%E5%AE%89%E8%A3%85"],
    ["Reference[^note]", "note", "a.md", "footnote-note"],
  ])("preserves Markdown navigation for %s", async (link, label, path, fragment) => {
    const openInstance = vi.fn().mockReturnValue({ kind: "opened" });
    const error = vi.fn();
    setup(
      "# 安装\n\n[^note]: Definition\n",
      `${link}\n\n# 安装\n\n[^note]: Definition\n`,
      "preview",
      {
        panels: { openInstance } as unknown as RendererPluginContext["panels"],
        files: {
          openInEditor: vi.fn().mockReturnValue(true),
        } as unknown as RendererPluginContext["files"],
        notifications: {
          error,
        } as unknown as RendererPluginContext["notifications"],
      }
    );
    const anchor = await screen.findByRole("link", { name: label });
    fireEvent.click(anchor);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          markdownAnchor: fragment,
          markdownAnchorRequestId: expect.any(String),
          source: { kind: "disk", root: "/repo", path },
        }),
      })
    );
    const firstRequest =
      openInstance.mock.calls[0]![0].params.markdownAnchorRequestId;
    fireEvent.click(anchor);
    expect(
      openInstance.mock.calls[1]![0].params.markdownAnchorRequestId
    ).not.toBe(firstRequest);
    expect(error).not.toHaveBeenCalled();
  });

  it("shows added and removed links in the prose without a duplicate address section", async () => {
    const { container } = setup(
      "Read [Old guide](old.md).\n",
      "Read [New guide](new.md).\n"
    );
    await screen.findByRole("link", { name: "New guide" });
    expect(container.querySelector("del a")).toHaveTextContent("Old guide");
    expect(container.querySelector("ins a")).toHaveTextContent("New guide");
    expect(screen.queryByText("Link changes")).toBeNull();
    expect(screen.queryByText("new.md")).toBeNull();
    expect(screen.queryByText("old.md")).toBeNull();
  });

  it("does not add address details for a link in a new document", async () => {
    const { container } = setup(
      "",
      "Read [Guide](../../../specs/design.md).\n"
    );
    await screen.findByText("Guide");
    expect(
      container.querySelector('[data-diff-kind="added"]')
    ).toHaveTextContent("Guide");
    expect(screen.queryByText("../../../specs/design.md")).toBeNull();
    expect(screen.queryByText("Link changes")).toBeNull();
  });

  it("keeps the changed link actionable and exposes a removed title on focus", async () => {
    const open = vi.fn().mockResolvedValue({ opened: true });
    setup(
      '[Guide](https://same.example "Old title")\n',
      "[Guide](https://same.example)\n",
      "preview",
      {
        externalNavigation: {
          open,
        } as unknown as RendererPluginContext["externalNavigation"],
      }
    );
    const link = await screen.findByRole("link", { name: "Guide" });
    expect(link).not.toHaveAttribute("title");
    act(() => link.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Link title changed"
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Old title");
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith("https://same.example");
  });

  it("shows source with an explanation if Markdown parsing fails", async () => {
    vi.mocked(markdownRuntime.parse).mockResolvedValue({
      status: "error",
      code: "worker-failed",
      revision: "failed",
    });
    const { container } = setup("old\n", "new\n");
    expect(
      await screen.findByText("Preview unavailable. Showing source changes.")
    ).toBeVisible();
    expect(container.querySelector("pre")).toHaveTextContent("old");
  });

  it("shows source for a formatting edit with no visible Markdown difference", async () => {
    const { container } = setup("Paragraph\n", "Paragraph  \n");
    expect(
      await screen.findByText(
        "This change needs the Source view to show all details."
      )
    ).toBeVisible();
    expect(container.querySelector("pre")?.textContent).toContain(
      "Paragraph  \n"
    );
    expect(screen.queryByRole("button", { name: "Retry preview" })).toBeNull();
  });

  it.each([
    ["Hello world\n", "Hello  world\n"],
    ["Hello\nworld\n", "Hello world\n"],
  ])("shows exact Source for invisible prose whitespace: %j", async (before, after) => {
    const { container } = setup(before, after);
    expect(
      await screen.findByText(
        "This change needs the Source view to show all details."
      )
    ).toBeVisible();
    expect(container.querySelector("pre")?.textContent).toContain(after);
    expect(screen.queryByRole("button", { name: "Retry preview" })).toBeNull();
  });

  it.each([
    ["Hello world\n", "Helloworld\n"],
    ["`Hello world`\n", "`Hello  world`\n"],
  ])("keeps visibly changed spacing in Preview: %j", async (before, after) => {
    const { container } = setup(before, after);
    await waitFor(() =>
      expect(container.querySelector("ins, del")).toBeTruthy()
    );
    expect(container.querySelector("pre")).toBeNull();
    expect(
      screen.queryByText(
        "This change needs the Source view to show all details."
      )
    ).toBeNull();
  });

  it("ignores parsing that completes after switching to Source", async () => {
    const parseNow = vi.mocked(markdownRuntime.parse).getMockImplementation()!;
    const completions: (() => Promise<void>)[] = [];
    vi.mocked(markdownRuntime.parse).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          completions.push(async () => resolve(await parseNow(input)));
        })
    );
    const { container } = setup("# Old\n", "# New\n");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }), {
      button: 0,
      ctrlKey: false,
    });
    await act(async () => {
      await Promise.all(completions.map((complete) => complete()));
    });
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector("pre")).toHaveTextContent("# Old");
  });

  it("never loads historical image paths from the current disk, including nested images", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const readDocument = vi
      .fn()
      .mockRejectedValue(new Error("no current image fixture"));
    const files = { readDocument } as unknown as RendererPluginContext["files"];
    setup("**![Old](old.png)**\n", "**![New](new.png)**\n", "preview", {
      files,
    });
    expect(
      await screen.findByText(
        "Historical images aren't loaded. Check their addresses and descriptions in Source."
      )
    ).toBeVisible();
    expect(readDocument.mock.calls).toEqual([
      [{ root: "/repo", path: "new.png" }],
    ]);
    expect(
      await screen.findByText("Old", { selector: ".md-img-fallback" })
    ).toBeVisible();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows complete deleted table content without editable column handles", async () => {
    setup("| Item | Result |\n| --- | --- |\n| Lost row | Evidence |\n", "");
    const table = await screen.findByRole("table");
    expect(table).toHaveTextContent("ItemResultLost rowEvidence");
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("uses shared reading preferences for the comparison prose", async () => {
    const { container } = setup("old\n", "new\n");
    await screen.findByText("new", { selector: "ins" });
    act(() =>
      useMarkdownPreviewPrefsStore.setState({
        fontScale: 1.15,
        measureMode: "wide",
        readingAppearance: "light",
      })
    );
    const prose = container.querySelector<HTMLElement>(
      '[data-slot="markdown-prose"]'
    );
    expect(prose?.style.getPropertyValue("--md-scale")).toBe("1.15");
    expect(prose).toHaveAttribute("data-measure", "wide");
    expect(prose?.closest("[data-reading-appearance]")).toHaveAttribute(
      "data-reading-appearance",
      "light"
    );
  });
});
