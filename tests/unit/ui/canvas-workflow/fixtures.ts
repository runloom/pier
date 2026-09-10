import type { ScreenFlowSpec } from "@pier/ui/canvas-workflow/screen-flow.ts";
import type { WorkflowSpec } from "@pier/ui/canvas-workflow/types.ts";

export const reviewWorkflowSpec: WorkflowSpec = {
  edges: [
    { from: "submit", id: "e-open", label: "Open review", to: "review" },
    { from: "review", id: "e-pass", label: "Approve", to: "pass" },
    {
      from: "review",
      id: "e-reject",
      label: "Send back",
      role: "error",
      to: "reject",
    },
    {
      from: "reject",
      id: "e-fix",
      label: "Revise",
      role: "return",
      to: "revise",
    },
    {
      from: "revise",
      id: "e-resubmit",
      label: "Resubmit",
      role: "branch",
      to: "review",
    },
  ],
  lanes: [
    { id: "happy", label: "Happy path" },
    { id: "recover", label: "Recover", variant: "exception" },
  ],
  mainPath: ["submit", "review", "pass"],
  nodes: [
    { col: 0, id: "submit", label: "Submit", lane: "happy" },
    { col: 1, id: "review", label: "Review", lane: "happy" },
    { col: 2, id: "pass", label: "Pass", lane: "happy" },
    { col: 1, id: "reject", label: "Reject", lane: "recover" },
    { col: 0, id: "revise", label: "Revise", lane: "recover" },
  ],
  title: "Review a change",
};

/** Error drop and retry share a column — the pairing-flow case. */
export const sameColumnReturnSpec: WorkflowSpec = {
  edges: [
    { from: "scan", id: "e-ok", label: "OK", to: "pass" },
    {
      from: "scan",
      id: "e-fail",
      label: "扫码失败",
      role: "error",
      to: "fail",
    },
    {
      from: "fail",
      id: "e-retry",
      label: "再试一次",
      role: "return",
      to: "scan",
    },
  ],
  lanes: [
    { id: "happy", label: "Happy path" },
    { id: "recover", label: "Recover", variant: "exception" },
  ],
  mainPath: ["scan", "pass"],
  nodes: [
    { col: 1, id: "scan", label: "Scan", lane: "happy" },
    { col: 2, id: "pass", label: "Pass", lane: "happy" },
    { col: 1, id: "fail", label: "Fail", lane: "recover" },
  ],
  title: "Retry",
};

/** Gallery-level gold aligned with templates/workflow.canvas.tsx. */
export const agentToolCallWorkflowSpec: WorkflowSpec = {
  edges: [
    { from: "user", id: "e-ask", label: "", to: "chat" },
    { from: "chat", id: "e-plan", label: "Plan", to: "planner" },
    { from: "planner", id: "e-route", label: "", to: "router" },
    {
      from: "router",
      id: "e-consent",
      label: "Consent?",
      to: "approval",
    },
    { from: "approval", id: "e-allow", label: "", to: "tool" },
    {
      from: "approval",
      id: "e-deny",
      label: "Deny",
      role: "error",
      to: "blocked",
    },
    { from: "blocked", id: "e-retry", label: "", to: "retry" },
    { from: "tool", id: "e-call", label: "", to: "external" },
    {
      from: "external",
      id: "e-reply",
      label: "",
      role: "return",
      to: "final",
    },
    {
      from: "external",
      id: "e-record",
      label: "Record",
      role: "branch",
      to: "trace",
    },
    {
      from: "store",
      id: "e-memory",
      label: "",
      role: "branch",
      to: "trace",
    },
  ],
  groups: [
    {
      fromCol: 2,
      id: "agent_loop",
      label: "Planning loop",
      lane: "agent",
      toCol: 3,
    },
    {
      fromCol: 3,
      id: "exception_path",
      label: "Human or policy stop",
      lane: "policy",
      toCol: 5,
    },
    {
      fromCol: 1,
      id: "evidence_path",
      label: "Evidence path",
      lane: "tools",
      toCol: 2,
    },
    {
      fromCol: 4,
      id: "tool_work",
      label: "Tool work",
      lane: "tools",
      toCol: 5,
    },
  ],
  lanes: [
    { id: "ui", label: "User Interface" },
    { id: "agent", label: "Agent Runtime" },
    { id: "policy", label: "Policy & Recovery", variant: "exception" },
    { id: "tools", label: "Tool Execution & Evidence" },
  ],
  mainPath: [
    "user",
    "chat",
    "planner",
    "router",
    "approval",
    "tool",
    "external",
    "final",
  ],
  nodes: [
    {
      col: 0,
      detail: "asks for work",
      id: "user",
      kind: "external",
      label: "User",
      lane: "ui",
    },
    {
      col: 1,
      detail: "thread + files",
      id: "chat",
      label: "Chat Surface",
      lane: "ui",
    },
    {
      col: 5,
      detail: "answer + changes",
      id: "final",
      label: "Final Reply",
      lane: "ui",
    },
    {
      col: 2,
      detail: "plan next step",
      id: "planner",
      label: "Agent Planner",
      lane: "agent",
    },
    {
      col: 3,
      detail: "choose capability",
      id: "router",
      label: "Tool Router",
      lane: "agent",
    },
    {
      col: 3,
      detail: "scope + consent",
      id: "approval",
      kind: "gate",
      label: "Approval Gate",
      lane: "policy",
    },
    {
      col: 4,
      detail: "wait or reject",
      id: "blocked",
      kind: "gate",
      label: "Blocked",
      lane: "policy",
    },
    {
      col: 5,
      detail: "revise request",
      id: "retry",
      kind: "system",
      label: "Retry Path",
      lane: "policy",
    },
    {
      col: 4,
      detail: "shell / browser / MCP",
      id: "tool",
      kind: "system",
      label: "Tool Call",
      lane: "tools",
    },
    {
      col: 5,
      detail: "network service",
      id: "external",
      kind: "external",
      label: "External API",
      lane: "tools",
    },
    {
      col: 1,
      detail: "repo + memory",
      id: "store",
      kind: "store",
      label: "Context Store",
      lane: "tools",
    },
    {
      col: 2,
      detail: "events + output",
      id: "trace",
      kind: "store",
      label: "Trace Log",
      lane: "tools",
    },
  ],
  notes: [
    {
      items: [
        "Lanes and columns place every step.",
        "Labels park off the ink; same-column returns use a C.",
      ],
      title: "Compiler contract",
    },
    {
      items: [
        "Approval gates risky work before tool execution.",
        "Evidence returns through isolated trace and memory.",
      ],
      title: "Runtime semantics",
    },
  ],
  phases: [
    { fromCol: 0, id: "intake", label: "Intake", toCol: 1 },
    { fromCol: 2, id: "reasoning", label: "Plan + route", toCol: 3 },
    { fromCol: 4, id: "execution", label: "Execute + report", toCol: 5 },
  ],
  title: "Agent tool call",
};

/** recipe=design gold path aligned with templates/design-mockup.canvas.tsx. */
export const designMockupScreenFlowSpec: ScreenFlowSpec = {
  edges: [
    { from: "library", id: "e-open", label: "Tap asset", to: "detail" },
    { from: "detail", id: "e-upload", label: "Tap Upload", to: "confirm" },
    { from: "confirm", id: "e-send", label: "Confirm", to: "success" },
    {
      from: "confirm",
      id: "e-fail",
      label: "Validation failed",
      role: "error",
      to: "blocked",
    },
    {
      from: "blocked",
      id: "e-retry",
      label: "Fix file",
      role: "return",
      to: "confirm",
    },
  ],
  mainPath: ["library", "detail", "confirm", "success"],
  start: "library",
  title: "Upload an asset",
};

export const designMockupFrameBoxes = [
  { h: 560, id: "library", w: 393, x: 40, y: 40 },
  { h: 560, id: "detail", w: 393, x: 641, y: 40 },
  { h: 560, id: "confirm", w: 393, x: 1234, y: 40 },
  { h: 560, id: "success", w: 393, x: 1827, y: 40 },
  { h: 560, id: "blocked", w: 393, x: 1234, y: 820 },
] as const;

export function crossingWorkflowSpec(): WorkflowSpec {
  return {
    edges: [{ from: "left", id: "e-skip", label: "Skip", to: "right" }],
    lanes: [{ id: "happy", label: "Happy path" }],
    nodes: [
      { col: 0, id: "left", label: "Left", lane: "happy" },
      { col: 1, id: "mid", label: "Mid", lane: "happy" },
      { col: 2, id: "right", label: "Right", lane: "happy" },
    ],
    title: "Crossing",
  };
}
