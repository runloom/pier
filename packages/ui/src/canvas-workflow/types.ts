export const WORKFLOW_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
export const WORKFLOW_COL_MAX = 8;
export const WORKFLOW_TAG_MAX = 24;

export type WorkflowEdgeRole = "main" | "branch" | "return" | "error";
export type WorkflowLaneVariant = "default" | "exception";
export type WorkflowNodeKind =
  | "step"
  | "gate"
  | "system"
  | "store"
  | "external";
export type WorkflowSide = "left" | "right" | "top" | "bottom";
export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
  "step",
  "gate",
  "system",
  "store",
  "external",
];

export interface WorkflowLane {
  readonly id: string;
  readonly label: string;
  readonly variant?: WorkflowLaneVariant;
}

export interface WorkflowNode {
  readonly col: number;
  readonly detail?: string;
  readonly id: string;
  readonly kind?: WorkflowNodeKind;
  readonly label: string;
  readonly lane: string;
  readonly tag?: string;
}

export interface WorkflowPhase {
  readonly fromCol: number;
  readonly id: string;
  readonly label: string;
  readonly toCol: number;
}

export interface WorkflowGroup {
  readonly fromCol: number;
  readonly id: string;
  readonly label: string;
  readonly lane: string;
  readonly toCol: number;
}

export interface WorkflowNote {
  readonly items: readonly string[];
  readonly title: string;
}

export interface WorkflowEdge {
  readonly from: string;
  readonly id: string;
  readonly label: string;
  readonly role?: WorkflowEdgeRole;
  readonly to: string;
}

export interface WorkflowSpec {
  readonly edges: readonly WorkflowEdge[];
  readonly groups?: readonly WorkflowGroup[];
  readonly lanes: readonly WorkflowLane[];
  readonly mainPath?: readonly string[];
  readonly nodes: readonly WorkflowNode[];
  readonly notes?: readonly WorkflowNote[];
  readonly phases?: readonly WorkflowPhase[];
  readonly title: string;
}

export interface WorkflowDiagnostic {
  readonly code: string;
  readonly evidence?: Readonly<Record<string, string | number>>;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly subject: {
    readonly nodeId?: string;
    readonly edgeId?: string;
    readonly path?: string;
  };
  readonly supportedFixes: readonly string[];
}

export interface WorkflowValidateReceipt {
  readonly diagnostics: readonly WorkflowDiagnostic[];
  readonly status: 0 | 1;
}

export interface WorkflowPoint {
  readonly x: number;
  readonly y: number;
}

export interface WorkflowNodeLayout {
  readonly detail: string;
  readonly h: number;
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly label: string;
  readonly tag: string;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

export interface WorkflowLaneLayout {
  readonly h: number;
  readonly id: string;
  readonly label: string;
  readonly variant: WorkflowLaneVariant;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

export interface WorkflowPhaseLayout {
  readonly id: string;
  readonly label: string;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

export interface WorkflowGroupLayout {
  readonly h: number;
  readonly id: string;
  readonly label: string;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

export interface WorkflowLegendItem {
  readonly kind: WorkflowNodeKind;
  readonly label: string;
}

export interface WorkflowEdgeLayout {
  readonly from: string;
  readonly id: string;
  readonly label: string;
  readonly labelAt: WorkflowPoint;
  readonly onMainPath: boolean;
  readonly points: readonly WorkflowPoint[];
  readonly role: WorkflowEdgeRole;
  readonly to: string;
}

export interface WorkflowLayout {
  readonly diagnostics: readonly WorkflowDiagnostic[];
  readonly edges: readonly WorkflowEdgeLayout[];
  readonly groups: readonly WorkflowGroupLayout[];
  readonly height: number;
  readonly lanes: readonly WorkflowLaneLayout[];
  readonly legend: readonly WorkflowLegendItem[];
  readonly legendY: number;
  readonly nodes: readonly WorkflowNodeLayout[];
  readonly notes: readonly WorkflowNote[];
  readonly notesY: number;
  readonly phases: readonly WorkflowPhaseLayout[];
  readonly title: string;
  readonly width: number;
}

export type WorkflowHover =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "edge"; readonly id: string }
  | null;
