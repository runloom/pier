import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { MarkdownCodeHighlighter } from "@plugins/builtin/files/renderer/markdown/markdown-code-highlighter.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/markdown-parser.ts";
import {
  type MarkdownRuntime,
  paginateMarkdownDocument,
} from "@plugins/builtin/files/renderer/markdown/markdown-runtime.ts";
import { MarkdownPreview } from "@plugins/builtin/files/renderer/markdown-preview.tsx";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function immediateRuntime(): MarkdownRuntime {
  return {
    closeSession: vi.fn(),
    dispose: vi.fn(),
    parse: vi.fn(async (input) => {
      const document = parseMarkdownToIr(input.source);
      return {
        document,
        pagination: paginateMarkdownDocument(document),
        revision: input.revision,
        status: "parsed" as const,
      };
    }),
    setSessionVisible: vi.fn(),
  };
}

const source = { kind: "disk" as const, path: "docs/readme.md", root: "/repo" };

describe("MarkdownPreview", () => {
  it("renders GFM from paginated IR and keeps raw HTML non-executable", async () => {
    const { container } = render(
      <MarkdownPreview
        labels={{
          copiedCode: "Copied",
          copyCode: "Copy code",
          completedTask: "Completed task",
          diagramFailed: "Unable to render diagram",
          diagramLabel: "Mermaid diagram",
          diagramPreviewTitle: "Diagram preview",
          imagePreviewFailed: "Unable to open image preview",
          imagePreviewTitle: "Image",
          incompleteTask: "Incomplete task",
          openFullscreen: "View fullscreen",
        }}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-gfm"
        source={source}
        value={[
          "# Guide",
          "",
          "- [x] shipped",
          "- [ ] pending",
          "",
          "| Name | Value |",
          "| --- | ---: |",
          "| A | 1 |",
          "",
          "<script>alert('never')</script>",
        ].join("\n")}
      />
    );

    expect(
      await screen.findByRole("heading", { name: "Guide" })
    ).toHaveAttribute("id", "guide");
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert('never')</script>")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Completed task" })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Incomplete task" })
    ).not.toBeChecked();
    expect(
      container.querySelectorAll('[data-slot="markdown-page"]')
    ).toHaveLength(1);
  });

  it("renders worker-highlighted code and reports copy completion", async () => {
    const copyCode = vi.fn(async () => undefined);
    const highlighter: MarkdownCodeHighlighter = {
      dispose: vi.fn(),
      highlight: vi.fn(async () => ({
        background: "#000000",
        foreground: "#ffffff",
        lines: [
          [{ color: "#ff0000", content: "const" }, { content: " value = 1" }],
        ],
        status: "highlighted" as const,
      })),
    };
    render(
      <MarkdownPreview
        codeHighlighter={highlighter}
        codeTheme="github-dark"
        copyCode={copyCode}
        labels={{
          completedTask: "Completed task",
          copiedCode: "Copied",
          copyCode: "Copy code",
          diagramFailed: "Unable to render diagram",
          diagramLabel: "Mermaid diagram",
          diagramPreviewTitle: "Diagram preview",
          imagePreviewFailed: "Unable to open image preview",
          imagePreviewTitle: "Image",
          incompleteTask: "Incomplete task",
          openFullscreen: "View fullscreen",
        }}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-code"
        source={source}
        value={"```ts\nconst value = 1\n```"}
      />
    );

    expect(await screen.findByText("const")).toHaveStyle({ color: "#ff0000" });
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => {
      expect(copyCode).toHaveBeenCalledWith("const value = 1");
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  });
  it("finds, highlights, and navigates visible Markdown text", async () => {
    const runtime = immediateRuntime();
    const view = render(
      <MarkdownPreview
        openExternal={vi.fn()}
        runtime={runtime}
        searchLabels={{
          close: "Close",
          matchAnnouncement: "Matches: {{count}}",
          next: "Next match",
          noMatches: "No matches",
          placeholder: "Find",
          previous: "Previous match",
        }}
        searchRequest={0}
        sessionId="markdown-search"
        source={source}
        value={"needle one\n\nneedle two"}
      />
    );
    view.rerender(
      <MarkdownPreview
        openExternal={vi.fn()}
        runtime={runtime}
        searchLabels={{
          close: "Close",
          matchAnnouncement: "Matches: {{count}}",
          next: "Next match",
          noMatches: "No matches",
          placeholder: "Find",
          previous: "Previous match",
        }}
        searchRequest={1}
        sessionId="markdown-search"
        source={source}
        value={"needle one\n\nneedle two"}
      />
    );

    const input = await screen.findByRole("textbox", { name: "Find" });
    fireEvent.change(input, { target: { value: "needle" } });
    await waitFor(() => {
      expect(
        document.querySelectorAll("mark[data-search-match-id]")
      ).toHaveLength(2);
    });
    expect(screen.getByText("1/2")).toBeVisible();
    expect(
      document.querySelectorAll('mark[data-active-search-match="true"]')
    ).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeVisible();
    expect(
      document.querySelectorAll('mark[data-active-search-match="true"]')
    ).toHaveLength(1);
  });

  it("renders KaTeX, sanitized Mermaid, and semantic directive blocks", async () => {
    const charts: RendererPluginContext["charts"] = {
      renderMermaid: vi.fn(async () => ({
        ok: true as const,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>Flow</text></svg>',
      })),
    };
    const { container } = render(
      <MarkdownPreview
        charts={charts}
        fileResources={{
          contentPreview: { openImage: vi.fn() },
          filePreviews: {
            issue: vi.fn(),
            release: vi.fn(),
          },
          files: { readDocument: vi.fn() },
        }}
        labels={{
          completedTask: "Completed task",
          copiedCode: "Copied",
          copyCode: "Copy code",
          diagramFailed: "Unable to render diagram",
          diagramLabel: "Mermaid diagram",
          diagramPreviewTitle: "Diagram preview",
          imagePreviewFailed: "Unable to open image preview",
          imagePreviewTitle: "Image",
          incompleteTask: "Incomplete task",
          openFullscreen: "View fullscreen",
        }}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-extensions"
        source={source}
        value={[
          "$$",
          "x^2 + y^2",
          "$$",
          "",
          "```mermaid",
          "graph TD; A-->B",
          "```",
          "",
          ':::note{title="Heads up"}',
          "Directive body",
          ":::",
          "",
          ":kbd[Ctrl K]",
        ].join("\n")}
      />
    );

    await waitFor(() => {
      expect(container.querySelector(".katex")).not.toBeNull();
      expect(container.querySelector("svg text")).toHaveTextContent("Flow");
    });
    expect(container.querySelector("svg script")).toBeNull();
    // Diagram must render at natural size — not wrapped in Button (which forces size-4 on SVG).
    expect(
      container
        .querySelector('[data-slot="markdown-diagram"]')
        ?.closest("button")
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "View fullscreen" })
    ).toBeVisible();
    expect(screen.getByText("Heads up")).toBeVisible();
    expect(screen.getByText("Directive body")).toBeVisible();
    expect(screen.getByText("Ctrl K").closest("kbd")).not.toBeNull();
  });

  it("stops nested double-click source jumps at the nearest block", async () => {
    const onJumpToSource = vi.fn();
    render(
      <MarkdownPreview
        onJumpToSource={onJumpToSource}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-source-jump"
        source={source}
        value={"- outer\n\n  inner paragraph"}
      />
    );

    const paragraph = await screen.findByText("inner paragraph");
    fireEvent.doubleClick(paragraph);
    expect(onJumpToSource).toHaveBeenCalledTimes(1);
    const jumpedOffset = onJumpToSource.mock.calls[0]?.[0] as number;
    expect(jumpedOffset).toBeGreaterThan(0);
  });

  it("opens diagram fullscreen preview from the media control", async () => {
    const openImage = vi.fn();
    const charts: RendererPluginContext["charts"] = {
      renderMermaid: vi.fn(async () => ({
        ok: true as const,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Flow</text></svg>',
      })),
    };
    const { container } = render(
      <MarkdownPreview
        charts={charts}
        fileResources={{
          contentPreview: { openImage },
          filePreviews: {
            issue: vi.fn(),
            release: vi.fn(),
          },
          files: { readDocument: vi.fn() },
        }}
        labels={{
          completedTask: "Completed task",
          copiedCode: "Copied",
          copyCode: "Copy code",
          diagramFailed: "Unable to render diagram",
          diagramLabel: "Mermaid diagram",
          diagramPreviewTitle: "Diagram preview",
          imagePreviewFailed: "Unable to open image preview",
          imagePreviewTitle: "Image",
          incompleteTask: "Incomplete task",
          openFullscreen: "View fullscreen",
        }}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-diagram-fullscreen"
        source={source}
        value={"```mermaid\ngraph TD; A-->B\n```"}
      />
    );

    await waitFor(() => {
      expect(container.querySelector("svg text")).toHaveTextContent("Flow");
    });
    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
    expect(openImage).toHaveBeenCalledTimes(1);
    const request = openImage.mock.calls[0]?.[0] as {
      source: { kind: string; src: string };
      title: string;
    };
    expect(request.title).toBe("Diagram preview");
    expect(request.source.kind).toBe("url");
    expect(request.source.src.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("routes external, anchor, and relative links through explicit host actions", async () => {
    const openExternal = vi.fn();
    const openInternal = vi.fn();
    const scrollIntoView = vi.fn();
    render(
      <MarkdownPreview
        openExternal={openExternal}
        openInternal={openInternal}
        runtime={immediateRuntime()}
        sessionId="markdown-links"
        source={source}
        value={[
          "# Target",
          "",
          "[Docs](https://example.com/docs) [Local](../guide.md#start) [Jump](#target)",
        ].join("\n")}
      />
    );
    const target = await screen.findByRole("heading", { name: "Target" });
    Object.defineProperty(target, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.click(screen.getByRole("link", { name: "Docs" }));
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
    fireEvent.click(screen.getByRole("link", { name: "Local" }));
    expect(openInternal).toHaveBeenCalledWith({
      fragment: "start",
      path: "guide.md",
    });
    fireEvent.click(screen.getByRole("link", { name: "Jump" }));
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });
  });

  it("renders and scrolls to an initial heading on a later semantic page", async () => {
    const scrollIntoView = vi.fn();
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    const originalObserver = globalThis.IntersectionObserver;
    class IdleIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];
      disconnect() {}
      observe() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      unobserve() {}
    }
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    globalThis.IntersectionObserver = IdleIntersectionObserver;
    try {
      const paragraphs = Array.from(
        { length: 100 },
        (_, index) => `paragraph ${index}`
      );
      const runtime = immediateRuntime();
      const value = [...paragraphs, "# Target"].join("\n\n");
      const view = render(
        <MarkdownPreview
          initialAnchor="target"
          initialAnchorRequestId="request-1"
          openExternal={vi.fn()}
          runtime={runtime}
          sessionId="markdown-initial-anchor"
          source={source}
          value={value}
        />
      );
      await screen.findByRole("heading", { name: "Target" });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledOnce();
      });

      view.rerender(
        <MarkdownPreview
          initialAnchor="target"
          initialAnchorRequestId="request-2"
          openExternal={vi.fn()}
          runtime={runtime}
          sessionId="markdown-initial-anchor"
          source={source}
          value={value}
        />
      );
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledTimes(2);
      });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScroll;
      globalThis.IntersectionObserver = originalObserver;
    }
  });

  it("routes middle-click through the supplied host callback", async () => {
    const openExternal = vi.fn();
    render(
      <MarkdownPreview
        openExternal={openExternal}
        runtime={immediateRuntime()}
        sessionId="markdown-middle-click"
        source={source}
        value="[Docs](https://example.com/docs)"
      />
    );

    const link = await screen.findByRole("link", { name: "Docs" });
    const event = new MouseEvent("auxclick", {
      bubbles: true,
      button: 1,
      cancelable: true,
    });
    expect(link.dispatchEvent(event)).toBe(false);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("renders non-HTTPS absolute schemes as disabled text", async () => {
    const openExternal = vi.fn();
    render(
      <MarkdownPreview
        openExternal={openExternal}
        runtime={immediateRuntime()}
        sessionId="markdown-unsafe"
        source={source}
        value="[HTTP](http://example.com) [Mail](mailto:user@example.com) [Malformed](https:) [Bad](javascript:alert(1))"
      />
    );
    await screen.findByText("HTTP");
    for (const name of ["HTTP", "Mail", "Malformed", "Bad"]) {
      const link = screen.getByText(name).closest("a");
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).not.toHaveAttribute("href");
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("issues and releases opaque tickets for relative images", async () => {
    const issue = vi.fn<RendererPluginContext["filePreviews"]["issue"]>(
      async () => ({
        expiresAt: 100,
        issued: true,
        ticket: "markdown-image-00000000",
        url: "pier-file-preview://file/markdown-image-00000000",
      })
    );
    const release = vi.fn(async () => true);
    const readDocument = vi.fn<RendererPluginContext["files"]["readDocument"]>(
      async (request) => ({
        canonicalPath: request.path,
        kind: "image",
        mime: "image/png",
        mtimeMs: 1,
        path: request.path,
        revision: "file-v1:image",
        root: request.root,
        size: 8,
      })
    );
    const view = render(
      <MarkdownPreview
        fileResources={{
          filePreviews: { issue, release },
          files: { readDocument },
        }}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-image"
        source={source}
        value="![Diagram](../assets/pic.png)"
      />
    );

    const image = await screen.findByRole("img", { name: "Diagram" });
    expect(image).toHaveAttribute(
      "src",
      "pier-file-preview://file/markdown-image-00000000"
    );
    expect(readDocument).toHaveBeenCalledWith({
      path: "assets/pic.png",
      root: "/repo",
    });
    view.unmount();
    await waitFor(() => {
      expect(release).toHaveBeenCalledWith("markdown-image-00000000");
    });
  });

  it("issues a dedicated ticket for image fullscreen and releases it on close", async () => {
    let ticketSerial = 0;
    const issue = vi.fn<RendererPluginContext["filePreviews"]["issue"]>(
      async () => {
        ticketSerial += 1;
        const ticket = `markdown-image-${String(ticketSerial).padStart(8, "0")}`;
        return {
          expiresAt: 100,
          issued: true,
          ticket,
          url: `pier-file-preview://file/${ticket}`,
        };
      }
    );
    const release = vi.fn(async () => true);
    const readDocument = vi.fn<RendererPluginContext["files"]["readDocument"]>(
      async (request) => ({
        canonicalPath: request.path,
        kind: "image",
        mime: "image/png",
        mtimeMs: 1,
        path: request.path,
        revision: "file-v1:image",
        root: request.root,
        size: 8,
      })
    );
    const openImage = vi.fn();
    render(
      <MarkdownPreview
        fileResources={{
          contentPreview: { openImage },
          filePreviews: { issue, release },
          files: { readDocument },
        }}
        labels={{
          completedTask: "Completed task",
          copiedCode: "Copied",
          copyCode: "Copy code",
          diagramFailed: "Unable to render diagram",
          diagramLabel: "Mermaid diagram",
          diagramPreviewTitle: "Diagram preview",
          imagePreviewFailed: "Unable to open image preview",
          imagePreviewTitle: "Image",
          incompleteTask: "Incomplete task",
          openFullscreen: "View fullscreen",
        }}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="markdown-image-fullscreen"
        source={source}
        value="![Diagram](../assets/pic.png)"
      />
    );

    await screen.findByRole("img", { name: "Diagram" });
    expect(issue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
    await waitFor(() => {
      expect(openImage).toHaveBeenCalledTimes(1);
    });
    expect(issue).toHaveBeenCalledTimes(2);
    const request = openImage.mock.calls[0]?.[0] as {
      onClose?: () => void;
      source: { kind: string; src: string };
      title: string;
    };
    expect(request.title).toBe("Diagram");
    expect(request.source.src).toBe(
      "pier-file-preview://file/markdown-image-00000002"
    );
    expect(release).not.toHaveBeenCalledWith("markdown-image-00000002");
    request.onClose?.();
    await waitFor(() => {
      expect(release).toHaveBeenCalledWith("markdown-image-00000002");
    });
  });

  it("keeps the find bar opposite the right outline", async () => {
    localStorage.removeItem("pier.files.markdown.tocSide");
    const runtime = immediateRuntime();
    const view = render(
      <MarkdownPreview
        openExternal={vi.fn()}
        runtime={runtime}
        searchLabels={{
          close: "Close",
          matchAnnouncement: "Matches: {{count}}",
          next: "Next match",
          noMatches: "No matches",
          placeholder: "Find",
          previous: "Previous match",
        }}
        searchRequest={0}
        sessionId="markdown-search-side"
        source={source}
        value={"# Title\n\n## Section\n\nneedle"}
      />
    );
    view.rerender(
      <MarkdownPreview
        openExternal={vi.fn()}
        runtime={runtime}
        searchLabels={{
          close: "Close",
          matchAnnouncement: "Matches: {{count}}",
          next: "Next match",
          noMatches: "No matches",
          placeholder: "Find",
          previous: "Previous match",
        }}
        searchRequest={1}
        sessionId="markdown-search-side"
        source={source}
        value={"# Title\n\n## Section\n\nneedle"}
      />
    );

    const searchBar = await screen.findByTestId("files-markdown-search-bar");
    expect(searchBar.className).toContain("left-3");
    expect(searchBar.className).not.toContain("right-3");
    localStorage.removeItem("pier.files.markdown.tocSide");
  });

  it("applies markdown-prose root without heading underlines and scales via --md-scale", async () => {
    localStorage.removeItem("pier.files.markdown.fontScale");
    localStorage.removeItem("pier.files.markdown.measureMode");
    localStorage.removeItem("pier.files.markdown.tocSide");
    const openImage = vi.fn();
    const registerSelectionSelectAllProvider = vi.fn(() => () => undefined);
    const onContextMenu = vi.fn();
    const { container } = render(
      <MarkdownPreview
        fileResources={{
          contentPreview: { openImage },
          filePreviews: {
            issue: vi.fn(),
            release: vi.fn(),
          },
          files: { readDocument: vi.fn() },
        }}
        onContextMenu={onContextMenu}
        openExternal={vi.fn()}
        panelId="panel-markdown-prose"
        registerSelectionSelectAllProvider={registerSelectionSelectAllProvider}
        runtime={immediateRuntime()}
        sessionId="markdown-prose"
        source={source}
        value={"# Title\n\n## Section\n\nParagraph with `code`."}
        zoomLabels={{
          reset: "Reset text size",
          zoomIn: "Increase text size",
          zoomOut: "Decrease text size",
        }}
      />
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="markdown-prose"]')
      ).not.toBeNull();
    });
    const prose = container.querySelector(
      '[data-slot="markdown-prose"]'
    ) as HTMLElement;
    expect(prose.style.getPropertyValue("--md-scale")).toBe("1");
    expect(prose).toHaveAttribute("data-measure", "comfortable");

    const h1 = await screen.findByRole("heading", { name: "Title", level: 1 });
    const h2 = screen.getByRole("heading", { name: "Section", level: 2 });
    expect(h1.className).toContain("md-h1");
    expect(h1.className).not.toContain("border-b");
    expect(h2.className).toContain("md-h2");
    expect(h2.className).not.toContain("border-b");
    expect(container.querySelector("code.md-inline-code")).not.toBeNull();
    expect(
      container.querySelector('[data-slot="markdown-font-scale"]')
    ).not.toBeNull();
    const toc = container.querySelector(
      '[data-slot="markdown-preview-toc"]'
    ) as HTMLElement;
    expect(toc).not.toBeNull();
    expect(toc).toHaveAttribute("data-side", "right");
    expect(toc).toHaveAttribute("data-placement", "overlay");

    expect(registerSelectionSelectAllProvider).toHaveBeenCalledWith(
      "panel-markdown-prose",
      expect.any(Function)
    );
    const selectAll = registerSelectionSelectAllProvider.mock.calls[0]?.[1] as
      | (() => boolean)
      | undefined;
    expect(selectAll?.()).toBe(true);
    expect(window.getSelection()?.toString()).toContain("Title");

    fireEvent.contextMenu(container.firstChild as HTMLElement);
    expect(onContextMenu).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Increase text size" }));
    await waitFor(() => {
      const scaled = container.querySelector(
        '[data-slot="markdown-prose"]'
      ) as HTMLElement;
      expect(scaled.style.getPropertyValue("--md-scale")).toBe("1.15");
    });

    const { writeMarkdownMeasureMode, writeMarkdownTocSide } = await import(
      "@plugins/builtin/files/renderer/markdown-preview-preferences.ts"
    );
    writeMarkdownMeasureMode("wide");
    writeMarkdownTocSide("left");
    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="markdown-prose"]')
      ).toHaveAttribute("data-measure", "wide");
      expect(
        container.querySelector('[data-slot="markdown-preview-toc"]')
      ).toHaveAttribute("data-side", "left");
    });

    localStorage.removeItem("pier.files.markdown.fontScale");
    localStorage.removeItem("pier.files.markdown.measureMode");
    localStorage.removeItem("pier.files.markdown.tocSide");
  });
});
