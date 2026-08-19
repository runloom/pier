import "@/app/globals.css";
import { Button } from "@pier/ui/button.tsx";
import {
  Mermaid,
  type MermaidNode,
  type MermaidRunStatus,
} from "@pier/ui/mermaid.tsx";
import i18next from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "@/i18n/index.ts";
import goldData from "../../../.pier/canvases/multi-agent-orchestration-gold/data.json" with {
  type: "json",
};
import { parseScheme } from "../../../.pier/canvases/multi-agent-orchestration-gold/model.ts";
import { GraphLayerKey } from "../../../.pier/canvases/multi-agent-orchestration-gold/shared.tsx";
import materialsData from "../../../.pier/canvases/workbench-into-canvas/data.json" with {
  type: "json",
};
import { parseScheme as parseMaterialsScheme } from "../../../.pier/canvases/workbench-into-canvas/model.ts";

await initI18n();
await i18next.changeLanguage("zh-CN");

const graphId =
  new URLSearchParams(window.location.search).get("graph") ?? "gold";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing root");
}

function pickGraph() {
  if (graphId === "live") {
    return {
      ariaLabel: "编译进行中，发布排队",
      diagram: {
        direction: "left-to-right" as const,
        edges: [{ source: "compile", target: "publish" }],
        nodes: [
          {
            contentHeight: 24,
            id: "compile",
            kind: "tool" as const,
            status: "running" as const,
            statusLabel: "进行中",
            title: "编译",
          },
          {
            contentHeight: 24,
            id: "publish",
            kind: "artifact" as const,
            status: "queued" as const,
            statusLabel: "排队",
            title: "发布",
          },
        ],
      },
      layerKey: null,
      title: "Live specimen",
    };
  }
  if (graphId === "dag") {
    return {
      ariaLabel: "画布编译流水线",
      diagram: {
        direction: "left-to-right" as const,
        edges: [
          { source: "src", target: "fence" },
          { source: "fence", target: "bundle" },
          { source: "bundle", target: "mount" },
        ],
        nodes: [
          {
            contentHeight: 20,
            id: "src",
            kind: "artifact" as const,
            meta: "canvas.tsx",
            status: "success" as const,
            title: "读取源码",
          },
          {
            contentHeight: 20,
            id: "fence",
            kind: "tool" as const,
            meta: "围栏",
            status: "success" as const,
            title: "校验 import",
          },
          {
            contentHeight: 20,
            id: "bundle",
            kind: "tool" as const,
            meta: "esbuild",
            status: "running" as const,
            title: "编译",
          },
          {
            contentHeight: 20,
            id: "mount",
            kind: "artifact" as const,
            meta: "独立 root",
            status: "queued" as const,
            title: "挂载",
          },
        ],
      },
      layerKey: null,
      title: "组件化 DAG：运行状态 + 节点内嵌进度",
    };
  }
  if (graphId === "materials") {
    const scheme = parseMaterialsScheme(JSON.stringify(materialsData));
    return {
      ariaLabel: "文件树、pier/canvas SDK、宿主 store 与 Live Modules 围栏",
      diagram: scheme.data.architecture.diagram,
      layerKey: null,
      title: scheme.data.meta.title,
    };
  }
  const scheme = parseScheme(JSON.stringify(goldData));
  return {
    ariaLabel: "协调智能体、Pier 智能体 CLI 与工作智能体的数据和控制流",
    diagram: scheme.data.architecture.diagram,
    layerKey: <GraphLayerKey />,
    title: scheme.data.meta.title,
  };
}

const DAG_STATUS_LABEL: Partial<Record<MermaidRunStatus, string>> = {
  queued: "排队",
  running: "进行中",
  success: "完成",
};

function renderDagNodeStatus(node: MermaidNode) {
  const label = node.status ? DAG_STATUS_LABEL[node.status] : undefined;
  if (!label) {
    return null;
  }
  return <p className="text-muted-foreground text-xs tabular-nums">{label}</p>;
}

function renderNodeContent(node: MermaidNode) {
  if (graphId === "live") {
    if (node.id === "compile") {
      return (
        <Button size="xs" type="button" variant="outline">
          取消
        </Button>
      );
    }
    return (
      <span className="flex h-full items-center text-muted-foreground! text-xs">
        排队
      </span>
    );
  }
  if (graphId === "dag") {
    return renderDagNodeStatus(node);
  }
  return;
}

const graph = pickGraph();

createRoot(root).render(
  <StrictMode>
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-[1080px]">
        <h1 className="mb-4 font-semibold text-xl">{graph.title}</h1>
        <Mermaid
          aria-label={graph.ariaLabel}
          direction={graph.diagram.direction}
          edges={graph.diagram.edges}
          expandable={false}
          nodes={graph.diagram.nodes}
          renderNodeContent={renderNodeContent}
        />
        {graph.layerKey ? <div className="mt-3">{graph.layerKey}</div> : null}
      </div>
    </div>
  </StrictMode>
);
