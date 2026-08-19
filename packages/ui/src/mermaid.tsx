"use client";

import type { MermaidProps } from "./mermaid/props.ts";
import { MermaidScene } from "./mermaid/scene.tsx";

export type {
  MermaidDirection,
  MermaidEdge,
  MermaidKind,
  MermaidNode,
  MermaidRunStatus,
  MermaidShape,
  MermaidTone,
} from "./mermaid/model.ts";
export type {
  MermaidProps,
  MermaidStageControlLabels,
} from "./mermaid/props.ts";

export function Mermaid(props: MermaidProps) {
  return <MermaidScene {...props} />;
}
