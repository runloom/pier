import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import { FileMermaidPreview } from "@plugins/builtin/files/renderer/preview/mermaid.tsx";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const t: FilesTranslate = (key, fallback) => fallback ?? key;

function createContext(
  renderMermaid: RendererPluginContext["charts"]["renderMermaid"]
) {
  return {
    appearance: {
      current: () => ({ theme: "light" as const }),
      onDidChange: () => () => undefined,
    },
    charts: { renderMermaid },
    contentPreview: {
      close: vi.fn(),
      openImage: vi.fn(),
      openMermaid: vi.fn(),
    },
  } as unknown as RendererPluginContext;
}

describe("FileMermaidPreview", () => {
  it("renders the diagram through the host mermaid renderer", async () => {
    const renderMermaid = vi.fn(async () => ({
      ok: true as const,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><text>Flow</text></svg>',
    }));

    const { container } = render(
      <FileMermaidPreview
        context={createContext(renderMermaid)}
        name="class-diagram.mermaid"
        source={"classDiagram\n  class Buffer"}
        t={t}
      />
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="markdown-diagram"] svg')
      ).not.toBeNull();
    });
    expect(renderMermaid).toHaveBeenCalledWith("classDiagram\n  class Buffer");
    expect(screen.getByRole("img", { name: "Mermaid diagram" })).toBeTruthy();
  });

  it("shows the syntax failure copy when rendering fails", async () => {
    const renderMermaid = vi.fn(async () => ({
      ok: false as const,
      reason: "render-failed" as const,
    }));

    render(
      <FileMermaidPreview
        context={createContext(renderMermaid)}
        name="broken.mermaid"
        source="classDiagram ???"
        t={t}
      />
    );

    expect(
      await screen.findByText(
        "Unable to render this diagram. Check the Mermaid syntax and try again."
      )
    ).toBeVisible();
  });

  it("treats an empty buffer as an empty file without calling mermaid", () => {
    const renderMermaid = vi.fn(async () => ({
      ok: true as const,
      svg: "<svg />",
    }));

    render(
      <FileMermaidPreview
        context={createContext(renderMermaid)}
        name="empty.mermaid"
        source={"  \n"}
        t={t}
      />
    );

    expect(
      screen.getByText(
        "This Mermaid file is empty. Write diagram syntax in the source view, then switch back to preview."
      )
    ).toBeVisible();
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("renders HTML labels whose void elements are serialized unclosed", async () => {
    // Mermaid emits `<br>` (HTML void, not XML `<br/>`) inside htmlLabels.
    // Re-parsing that string as XML used to reject every such diagram.
    const renderMermaid = vi.fn(async () => ({
      ok: true as const,
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">',
        '<g class="node"><rect></rect>',
        '<foreignObject width="320" height="200">',
        '<div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">',
        "<p>会话领域事件流<br>stream = session_id</p>",
        "</span></div></foreignObject></g></svg>",
      ].join(""),
    }));

    const { container } = render(
      <FileMermaidPreview
        context={createContext(renderMermaid)}
        name="event-flow.mermaid"
        source={"flowchart TD\n  A[会话领域事件流<br/>stream = session_id]"}
        t={t}
      />
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="markdown-diagram"] svg br')
      ).not.toBeNull();
    });
    expect(
      screen.queryByText(
        "Unable to render this diagram. Check the Mermaid syntax and try again."
      )
    ).toBeNull();
  });

  it("still strips active markup after the HTML parse", async () => {
    const renderMermaid = vi.fn(async () => ({
      ok: true as const,
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" onload="alert(1)">',
        "<script>alert(1)</script>",
        '<a href="https://example.com"><text>link</text></a>',
        '<g class="node" onclick="alert(2)"><text>Flow</text></g>',
        "</svg>",
      ].join(""),
    }));

    const { container } = render(
      <FileMermaidPreview
        context={createContext(renderMermaid)}
        name="sanitized.mermaid"
        source={"flowchart TD\n  A-->B"}
        t={t}
      />
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="markdown-diagram"] svg text')
      ).not.toBeNull();
    });
    expect(container.querySelector("svg script")).toBeNull();
    expect(container.querySelector("svg [onload]")).toBeNull();
    expect(container.querySelector("svg [onclick]")).toBeNull();
    expect(container.querySelector('svg a[href^="https"]')).toBeNull();
  });

  it("shows a skeleton while the document is still loading", () => {
    const renderMermaid = vi.fn(async () => ({
      ok: true as const,
      svg: "<svg />",
    }));

    const { container } = render(
      <FileMermaidPreview
        context={createContext(renderMermaid)}
        loading
        name="loading.mermaid"
        source=""
        t={t}
      />
    );

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(renderMermaid).not.toHaveBeenCalled();
  });
});
