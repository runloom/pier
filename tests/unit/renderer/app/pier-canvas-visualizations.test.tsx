// @vitest-environment jsdom
import { DataChart } from "@pier/ui/data-chart.tsx";
import { NodeGraph } from "@pier/ui/node-graph.tsx";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostNodeGraph } from "@/lib/live-modules/host-node-graph.tsx";
import { MermaidDiagram } from "@/lib/live-modules/mermaid-diagram.tsx";
import { renderOfficialMermaid } from "@/lib/live-modules/official-mermaid-renderer.ts";
import { useContentPreviewStore } from "@/stores/content-preview.store.ts";

const NODES = [
  { id: "T0", title: "边界", tone: "done" as const },
  {
    id: "T1",
    title: "图表协议",
    tone: "success" as const,
  },
  {
    id: "T2",
    title: "产品面",
    tone: "warning" as const,
  },
];
const EDGES = [
  { source: "T0", target: "T1" },
  { source: "T1", target: "T2" },
];

describe("Pier Canvas visualizations", () => {
  it("renders different official Mermaid diagram families through one capability", async () => {
    const sources = [
      "flowchart LR\nA --> B",
      "sequenceDiagram\nA->>B: hello",
      [
        "gantt",
        "title Delivery",
        "dateFormat YYYY-MM-DD",
        "section Build",
        "Capability :done, a1, 2026-07-28, 1d",
      ].join("\n"),
    ];

    for (const source of sources) {
      const result = await renderOfficialMermaid(source, "dark");
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) {
        expect(result.diagramType.length).toBeGreaterThan(0);
        expect(result.svg).toContain("<svg");
        expect(result.svg).not.toContain("<script");
      }
    }
  }, 15_000);

  it("selects nodes through the XYFlow-backed stable facade", async () => {
    const onSelect = vi.fn();
    render(
      <NodeGraph
        aria-label="实施路线"
        edges={EDGES}
        nodes={NODES}
        onSelectNode={onSelect}
        selectedId="T1"
      />
    );

    const productNode = await screen.findByLabelText("T2 产品面");
    fireEvent.click(productNode);
    expect(onSelect).toHaveBeenCalledWith("T2");

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="node-graph"] .react-flow')
      ).toBeTruthy()
    );
    const surface = document.querySelector(
      '[data-slot="node-graph"]'
    ) as HTMLElement | null;
    expect(surface).toBeTruthy();
    expect(surface?.style.height).toMatch(/^\d+px$/);
    expect(Number.parseInt(surface?.style.height ?? "0", 10)).toBeGreaterThan(
      0
    );
    // Inline overview: no zoom chrome (xyflow default or product strip).
    expect(document.querySelector(".react-flow__controls")).toBeNull();
    expect(
      document.querySelector('[data-slot="image-preview-controls"]')
    ).toBeNull();
    // Expand needs onOpenFullscreen (host wires content preview).
    expect(
      screen.queryByRole("button", { name: "View fullscreen" })
    ).toBeNull();
  });

  it("shows fullscreen control only when onOpenFullscreen is provided", async () => {
    const onOpenFullscreen = vi.fn();
    render(
      <NodeGraph
        aria-label="实施路线"
        edges={EDGES}
        expandLabel="展开关系图"
        nodes={NODES}
        onOpenFullscreen={onOpenFullscreen}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "展开关系图" }));
    expect(onOpenFullscreen).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-slot="node-graph-expanded"]')
    ).toBeNull();
  });

  it("opens host content preview store from HostNodeGraph fullscreen", async () => {
    useContentPreviewStore.setState({
      id: "content-preview",
      onClose: null,
      open: false,
      payload: null,
      title: "",
    });

    render(
      <HostNodeGraph
        aria-label="实施路线"
        edges={EDGES}
        expandLabel="查看全屏"
        nodes={NODES}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "查看全屏" }));

    const state = useContentPreviewStore.getState();
    expect(state.open).toBe(true);
    expect(state.title).toBe("实施路线");
    expect(state.payload?.type).toBe("node-graph");
    if (state.payload?.type === "node-graph") {
      expect(state.payload.nodes).toHaveLength(3);
      expect(state.payload.edges).toHaveLength(2);
    }
  });

  it("stage presentation fills without card chrome and shows zoom strip", async () => {
    render(
      <div style={{ height: 480 }}>
        <NodeGraph
          aria-label="全屏图"
          edges={EDGES}
          nodes={NODES}
          presentation="stage"
        />
      </div>
    );

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="node-graph-stage"]')
      ).toBeTruthy()
    );
    expect(
      document.querySelector('[data-slot="image-preview-controls"]')
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "View fullscreen" })
    ).toBeNull();
  });

  it("hides expand control when expandable is false", async () => {
    render(
      <NodeGraph
        aria-label="只读图"
        edges={EDGES}
        expandable={false}
        nodes={NODES}
        onOpenFullscreen={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="node-graph"] .react-flow')
      ).toBeTruthy()
    );
    expect(
      screen.queryByRole("button", { name: "View fullscreen" })
    ).toBeNull();
  });

  it("opens host content preview from MermaidDiagram fullscreen control", async () => {
    useContentPreviewStore.setState({
      id: "content-preview",
      onClose: null,
      open: false,
      payload: null,
      title: "",
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      ((_element: Element) =>
        ({
          getPropertyValue: (name: string) => {
            if (name === "--background") return "oklch(0.2 0 0)";
            if (name === "--foreground") return "oklch(0.95 0 0)";
            if (name === "--muted-foreground") return "oklch(0.7 0 0)";
            return "";
          },
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );

    render(
      <MermaidDiagram
        aria-label="流程预览"
        expandLabel="全屏查看"
        source={"flowchart LR\nA --> B"}
      />
    );

    const fullscreen = await screen.findByRole("button", { name: "全屏查看" });
    fireEvent.click(fullscreen);

    await waitFor(() => {
      const state = useContentPreviewStore.getState();
      expect(state.open).toBe(true);
      expect(state.title).toBe("流程预览");
      expect(state.payload?.type).toBe("image");
      if (
        state.payload?.type === "image" &&
        state.payload.source.kind === "url"
      ) {
        expect(state.payload.source.src).toMatch(/^data:image\/svg\+xml/);
      }
    });
  }, 15_000);

  it("renders a high-level data chart without exposing Recharts to callers", () => {
    const { container } = render(
      <DataChart
        aria-label="能力完成趋势"
        categoryKey="name"
        data={[
          { name: "协议", value: 1 },
          { name: "DAG", value: 2 },
        ]}
        series={[{ key: "value", label: "完成数" }]}
        type="bar"
      />
    );

    expect(container.querySelector('[data-slot="data-chart"]')).toBeTruthy();
    expect(screen.getByRole("img", { name: "能力完成趋势" })).toBeTruthy();
  });

  it("shows an explicit empty state", () => {
    render(
      <DataChart
        aria-label="空图表"
        categoryKey="name"
        data={[]}
        series={[{ key: "value", label: "完成数" }]}
        type="line"
      />
    );
    expect(screen.getByText("暂无可绘制的数据。")).toBeTruthy();
  });
});
