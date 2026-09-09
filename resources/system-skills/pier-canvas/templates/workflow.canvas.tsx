import { WorkflowDiagram, type WorkflowSpec } from "pier/canvas";

/**
 * recipe=workflow gold: lanes, phases, groups, two-line steps, host notes.
 * Do not copy Archify's HTML viewer, Share Card, views, animation, or
 * node-type rainbow. Do not set x/y/via/labelAt/fromSide/color.
 * Call validateWorkflowSpec; apply the first supportedFix.
 * Rewrite every user-visible string into the user's language.
 */
export const canvas = {
  description:
    "Agent tool call: plan, approve or deny, execute, and return a reply.",
  kind: "composition" as const,
  title: "Agent tool call",
};

const spec: WorkflowSpec = {
  edges: [
    { from: "user", id: "e-ask", label: "", to: "chat" },
    { from: "chat", id: "e-plan", label: "Plan", to: "planner" },
    { from: "planner", id: "e-route", label: "", to: "router" },
    {
      from: "router",
      id: "e-consent",
      label: "Needs consent?",
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
        "Labels sit on the longest run; same-column retries take a C-shape.",
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

export default function Canvas() {
  return <WorkflowDiagram spec={spec} />;
}
