// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DataChart } from "@pier/ui/data-chart.tsx";
import { Mermaid } from "@pier/ui/mermaid.tsx";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { HostMermaid } from "@/lib/live-modules/host-mermaid.tsx";
import { useContentPreviewStore } from "@/stores/content-preview.store.ts";
import { parseScheme as parseWorkbenchScheme } from "../../../../.pier/canvases/workbench-into-canvas/model.ts";
import { installSvgLayoutStubs } from "../../../support/svg-layout-stubs.ts";

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
  beforeAll(async () => {
    configure({ asyncUtilTimeout: 15_000 });
    installSvgLayoutStubs();
    await initI18n();
  });

  afterEach(() => {
    cleanup();
  });

  it("selects slotted mermaid nodes through the stable facade", async () => {
    const onSelect = vi.fn();
    render(
      <Mermaid
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
      expect(document.querySelector('[data-slot="mermaid"] svg')).toBeTruthy()
    );
    expect(
      document.querySelector('[data-slot="image-preview-controls"]')
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "View fullscreen" })
    ).toBeNull();
    expect(screen.getByText("产品面")).toBeTruthy();
    expect(
      document.querySelector('[data-slot="mermaid-node"] code')
    ).toBeNull();
    expect(document.querySelector(".react-flow")).toBeNull();
    expect(
      document.querySelector('[data-slot="mermaid-node"]')?.className
    ).not.toMatch(/\boverflow-hidden\b/);
  });

  it("routes bidirectional edges without stacking nodes", async () => {
    render(
      <Mermaid
        aria-label="回边"
        direction="top-to-bottom"
        edges={[
          { source: "O", target: "N" },
          { source: "N", target: "O" },
          { source: "O", target: "L" },
          { source: "L", target: "O" },
        ]}
        expandable={false}
        nodes={[
          { id: "N", title: "原生" },
          { id: "O", title: "协调" },
          { id: "L", title: "本地" },
        ]}
      />
    );

    await screen.findByText("协调");
    expect(screen.getByText("原生")).toBeTruthy();
    expect(screen.getByText("本地")).toBeTruthy();
  });

  it("paints semantic tone as tint + strong hue outline, not a left rail", async () => {
    render(
      <Mermaid
        aria-label="状态图"
        edges={[{ source: "a", target: "b" }]}
        expandable={false}
        nodes={[
          { id: "a", title: "中性" },
          { id: "b", title: "警告", tone: "warning" },
        ]}
      />
    );

    const warning = await screen.findByLabelText("b 警告");
    const warningCard = warning.querySelector('[data-slot="mermaid-node"]');
    expect(warningCard?.className).toContain("border-status-warning-border");
    expect(warningCard?.className).toContain("bg-status-warning-bg");
    expect(warningCard?.getAttribute("style")).toBeNull();
    expect(warningCard?.getAttribute("data-tone")).toBe("warning");

    const neutralCard = screen
      .getByLabelText("a 中性")
      .querySelector('[data-slot="mermaid-node"]');
    expect(neutralCard?.className).toContain("bg-card");
    expect(neutralCard?.className).not.toContain("bg-status-");
    expect(neutralCard?.getAttribute("data-tone")).toBe("muted");
    expect(neutralCard?.getAttribute("data-kind")).toBe("none");
    expect(
      document.querySelector('[data-slot="mermaid-node"] > span.absolute')
    ).toBeNull();
  });

  it("paints architecture kind as tint + hue hairline + glyph, not a left rail", async () => {
    render(
      <Mermaid
        aria-label="角色图"
        edges={[{ source: "h", target: "e", label: "产品外" }]}
        expandable={false}
        nodes={[
          { id: "h", kind: "actor", title: "人类" },
          { id: "e", kind: "external", title: "外部" },
        ]}
      />
    );

    const human = await screen.findByLabelText("h 人类");
    const humanCard = human.querySelector('[data-slot="mermaid-node"]');
    expect(humanCard?.getAttribute("data-kind")).toBe("actor");
    expect(humanCard?.className).toContain("border-status-info-border");
    expect(humanCard?.className).toContain("bg-status-info-bg");
    expect(human.querySelector("svg")).toBeTruthy();

    const external = screen.getByLabelText("e 外部");
    const externalCard = external.querySelector('[data-slot="mermaid-node"]');
    expect(externalCard?.className).toContain("border-status-warning-border");
    expect(externalCard?.className).toContain("bg-status-warning-bg");
    expect(externalCard?.className).toContain("border-dashed");
    expect(
      document.querySelector('[data-slot="mermaid-node"] > span.absolute')
    ).toBeNull();
  });

  it("paints tool and agent kinds with chromatic status surfaces", async () => {
    render(
      <Mermaid
        aria-label="角色色"
        edges={[{ source: "o", target: "c" }]}
        expandable={false}
        nodes={[
          { id: "o", kind: "agent", title: "协调" },
          { id: "c", kind: "tool", title: "CLI" },
          { id: "p", kind: "artifact", title: "画面" },
        ]}
      />
    );
    const agent = (await screen.findByLabelText("o 协调")).querySelector(
      '[data-slot="mermaid-node"]'
    );
    const tool = (await screen.findByLabelText("c CLI")).querySelector(
      '[data-slot="mermaid-node"]'
    );
    const artifact = (await screen.findByLabelText("p 画面")).querySelector(
      '[data-slot="mermaid-node"]'
    );
    expect(agent?.className).toContain("border-status-done-border");
    expect(agent?.className).toContain("bg-status-done-bg");
    expect(tool?.className).toContain("border-status-success-border");
    expect(tool?.className).toContain("bg-status-success-bg");
    expect(artifact?.className).toContain("border-status-info-border");
    expect(artifact?.className).toContain("bg-status-info-bg");
    expect(artifact?.className).toContain("border-dashed");
  });

  it("paints workbench gold main-loop kinds from data.json", async () => {
    const raw = readFileSync(
      join(process.cwd(), ".pier/canvases/workbench-into-canvas/data.json"),
      "utf8"
    );
    const scheme = parseWorkbenchScheme(raw);
    render(
      <Mermaid
        aria-label="主回路"
        direction={scheme.data.mainLoop.diagram.direction}
        edges={scheme.data.mainLoop.diagram.edges}
        expandable={false}
        nodes={scheme.data.mainLoop.diagram.nodes}
      />
    );
    const generate = await screen.findByLabelText("Skill pier-canvas 生成");
    expect(
      generate
        .querySelector("[data-slot=mermaid-node]")
        ?.getAttribute("data-kind")
    ).toBe("tool");
    const see = screen.getByLabelText("OpenSettings 打开设置 项目 物料");
    expect(
      see.querySelector("[data-slot=mermaid-node]")?.getAttribute("data-kind")
    ).toBe("artifact");
  });

  it("renders no kind legend overlay (glyph + hue carry the role)", async () => {
    render(
      <Mermaid
        aria-label="角色图例"
        edges={[{ source: "h", target: "c" }]}
        expandable={false}
        nodes={[
          { id: "h", kind: "actor", title: "人类" },
          { id: "c", kind: "tool", title: "CLI" },
        ]}
      />
    );
    await screen.findByLabelText("h 人类");
    expect(
      document.querySelector('[data-slot="diagram-kind-legend"]')
    ).toBeNull();
  });

  it("lets status tone win the surface when kind is also set", async () => {
    render(
      <Mermaid
        aria-label="状态覆盖"
        edges={[]}
        expandable={false}
        nodes={[{ id: "x", kind: "tool", title: "出口", tone: "danger" }]}
      />
    );
    const card = (await screen.findByLabelText("x 出口")).querySelector(
      '[data-slot="mermaid-node"]'
    );
    expect(card?.className).toContain("border-status-danger-border");
    expect(card?.className).toContain("bg-status-danger-bg");
    expect(card?.className).not.toContain("bg-status-success-bg");
    expect(card?.getAttribute("data-kind")).toBe("tool");
  });

  it("shows fullscreen control only when onOpenFullscreen is provided", async () => {
    const onOpenFullscreen = vi.fn();
    render(
      <Mermaid
        aria-label="实施路线"
        edges={EDGES}
        expandLabel="展开关系图"
        nodes={NODES}
        onOpenFullscreen={onOpenFullscreen}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "展开关系图" }));
    expect(onOpenFullscreen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-slot="diagram-expanded"]')).toBeNull();
  });

  it("opens host content preview store from HostMermaid fullscreen", async () => {
    useContentPreviewStore.setState({
      id: "content-preview",
      onClose: null,
      open: false,
      payload: null,
      title: "",
    });

    render(
      <HostMermaid
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
    expect(state.payload?.type).toBe("mermaid");
    if (state.payload?.type === "mermaid") {
      expect(state.payload.nodes).toHaveLength(3);
      expect(state.payload.edges).toHaveLength(2);
    }
  });

  it("stage presentation fills without card chrome and shows zoom strip", async () => {
    render(
      <div style={{ height: 480 }}>
        <Mermaid
          aria-label="全屏图"
          edges={EDGES}
          nodes={NODES}
          presentation="stage"
        />
      </div>
    );

    await waitFor(() =>
      expect(document.querySelector('[data-slot="mermaid-stage"]')).toBeTruthy()
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

  it("compiles vertical flowcharts", async () => {
    render(
      <Mermaid
        aria-label="纵向图"
        direction="top-to-bottom"
        edges={EDGES}
        expandable={false}
        nodes={NODES}
      />
    );

    await screen.findByLabelText("T2 产品面");
    expect(document.querySelector('[data-slot="mermaid"] svg')).toBeTruthy();
  });

  it("hides expand control when expandable is false", async () => {
    render(
      <Mermaid
        aria-label="只读图"
        edges={EDGES}
        expandable={false}
        nodes={NODES}
        onOpenFullscreen={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(document.querySelector('[data-slot="mermaid"] svg')).toBeTruthy()
    );
    expect(
      screen.queryByRole("button", { name: "View fullscreen" })
    ).toBeNull();
  });

  it("shows live run-status glyphs for DAG nodes", async () => {
    render(
      <Mermaid
        aria-label="运行图"
        edges={[{ source: "a", target: "b" }]}
        expandable={false}
        nodes={[
          { id: "a", status: "running", title: "编译" },
          { id: "b", status: "success", statusLabel: "已完成", title: "发布" },
          { id: "c", status: "failed", title: "校验" },
        ]}
      />
    );
    await screen.findByLabelText("a 编译");
    expect(document.querySelector('[data-run-status="running"]')).toBeTruthy();
    const success = document.querySelector('[data-run-status="success"]');
    expect(success?.getAttribute("aria-label")).toBe("已完成");
    const failed = await waitFor(() => {
      const glyph = document.querySelector('[data-run-status="failed"]');
      expect(glyph).toBeTruthy();
      return glyph;
    });
    expect(failed?.getAttribute("aria-label")).toBe("failed");
  });

  it("renders embedded node content inside the reserved slot", async () => {
    render(
      <Mermaid
        aria-label="嵌入图"
        edges={[]}
        expandable={false}
        nodes={[{ contentHeight: 24, id: "a", title: "任务" }]}
        renderNodeContent={(node) =>
          node.id === "a" ? <em data-testid="embedded">73%</em> : null
        }
      />
    );
    const embedded = await screen.findByTestId("embedded");
    const slot = embedded.closest('[data-slot="mermaid-node-content"]');
    expect(slot).toBeTruthy();
    expect((slot as HTMLElement).style.height).toBe("24px");
  });

  it("renders native mermaid class diagrams from source", async () => {
    render(
      <Mermaid
        aria-label="类图"
        expandable={false}
        source={`classDiagram
  direction TB
  class animal["Animal"] {
    +name
    +speak()
  }
  class dog["Dog"] {
    +breed
    +bark()
  }
  animal <|-- dog`}
      />
    );
    await screen.findByText("Animal");
    expect(
      document.querySelector('svg[aria-roledescription="class"]')
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="mermaid-node"]')).toBeNull();
    expect(screen.getByText("+name")).toBeTruthy();
    expect(screen.getByText("+speak()")).toBeTruthy();
  });

  it("renders native mermaid sequence from source", async () => {
    render(
      <Mermaid
        aria-label="时序图"
        expandable={false}
        source={`sequenceDiagram
  participant a as 调用方
  participant b as 服务
  a->>+ b: 请求
  b-->>- a: 回复`}
      />
    );
    await screen.findByText("调用方");
    expect(
      document.querySelector('svg[aria-roledescription="sequence"]')
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="mermaid-node"]')).toBeNull();
  });

  it("renders native mermaid ER from source", async () => {
    render(
      <Mermaid
        aria-label="实体关系"
        expandable={false}
        source={`erDiagram
  客户 {
    string id
  }
  订单 {
    string id
  }
  客户 ||--o{ 订单 : 下单`}
      />
    );
    await screen.findByText("客户");
    expect(
      document.querySelector('svg[aria-roledescription="er"]')
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="mermaid-node"]')).toBeNull();
  });

  it("renders native mermaid mindmap from source", async () => {
    render(
      <Mermaid
        aria-label="思维导图"
        expandable={false}
        source={`mindmap
  root((画布))
    a[版式]
    b[控件]`}
      />
    );
    await screen.findByText("画布");
    expect(
      document.querySelector('svg[aria-roledescription="mindmap"]')
    ).toBeTruthy();
  });

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
