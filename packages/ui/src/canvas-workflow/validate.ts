import { compileWorkflowLayout } from "./compile.ts";
import {
  WORKFLOW_COL_MAX,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_TAG_MAX,
  type WorkflowDiagnostic,
  type WorkflowSpec,
  type WorkflowValidateReceipt,
} from "./types.ts";

function error(
  code: string,
  message: string,
  subject: WorkflowDiagnostic["subject"],
  supportedFixes: readonly string[],
  evidence?: WorkflowDiagnostic["evidence"]
): WorkflowDiagnostic {
  return {
    code,
    message,
    severity: "error",
    subject,
    supportedFixes,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function uniqueIds(
  kind: "lane" | "node" | "edge" | "phase" | "group",
  ids: readonly string[]
): WorkflowDiagnostic[] {
  const seen = new Set<string>();
  const out: WorkflowDiagnostic[] = [];
  for (const [index, id] of ids.entries()) {
    const path = `/${kind}s/${index}/id`;
    if (!WORKFLOW_ID_PATTERN.test(id)) {
      out.push(
        error(
          `workflow/${kind}-id`,
          `${kind} id "${id}" must match ${WORKFLOW_ID_PATTERN.source}.`,
          { path },
          [`Rename the ${kind} to a letter-led id such as step1.`]
        )
      );
    }
    if (seen.has(id)) {
      out.push(
        error(
          `workflow/${kind}-duplicate`,
          `${kind} id "${id}" is used more than once.`,
          { path },
          [`Give this ${kind} a unique id.`]
        )
      );
    }
    seen.add(id);
  }
  return out;
}

function structuralDiagnostics(spec: WorkflowSpec): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  if (spec.title.trim() === "") {
    diagnostics.push(
      error(
        "workflow/title",
        "title must be a non-empty string.",
        { path: "/title" },
        ["Set meta title to the user goal, such as Pair a computer."]
      )
    );
  }
  if (spec.lanes.length < 1) {
    diagnostics.push(
      error(
        "workflow/lanes",
        "A workflow needs at least one lane.",
        { path: "/lanes" },
        ["Add a happy-path lane with id happy."]
      )
    );
  }
  if (spec.nodes.length < 1) {
    diagnostics.push(
      error(
        "workflow/nodes",
        "A workflow needs at least one node.",
        { path: "/nodes" },
        ["Add the first step as a node with lane and col."]
      )
    );
  }
  diagnostics.push(
    ...uniqueIds(
      "lane",
      spec.lanes.map((lane) => lane.id)
    ),
    ...uniqueIds(
      "node",
      spec.nodes.map((node) => node.id)
    ),
    ...uniqueIds(
      "edge",
      spec.edges.map((edge) => edge.id)
    ),
    ...uniqueIds(
      "phase",
      (spec.phases ?? []).map((phase) => phase.id)
    ),
    ...uniqueIds(
      "group",
      (spec.groups ?? []).map((group) => group.id)
    )
  );

  const laneById = new Map(spec.lanes.map((lane) => [lane.id, lane]));
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));

  for (const [index, node] of spec.nodes.entries()) {
    if (!laneById.has(node.lane)) {
      diagnostics.push(
        error(
          "workflow/unknown-lane",
          `Node "${node.id}" points at unknown lane "${node.lane}".`,
          { nodeId: node.id, path: `/nodes/${index}/lane` },
          [
            `Set lane to one of: ${[...laneById.keys()].join(", ") || "(none)"}.`,
          ]
        )
      );
    }
    if (
      !Number.isInteger(node.col) ||
      node.col < 0 ||
      node.col > WORKFLOW_COL_MAX
    ) {
      diagnostics.push(
        error(
          "workflow/column",
          `Node "${node.id}" col must be an integer 0..${WORKFLOW_COL_MAX}.`,
          { nodeId: node.id, path: `/nodes/${index}/col` },
          [`Move "${node.id}" to a column between 0 and ${WORKFLOW_COL_MAX}.`],
          { col: node.col }
        )
      );
    }
    if (node.kind && !WORKFLOW_NODE_KINDS.includes(node.kind)) {
      diagnostics.push(
        error(
          "workflow/node-kind",
          `Node "${node.id}" kind must be step, gate, system, store, or external.`,
          { nodeId: node.id, path: `/nodes/${index}/kind` },
          [
            `Set kind on "${node.id}" to step, gate, system, store, or external.`,
          ]
        )
      );
    }
    const tag = node.tag?.trim() ?? "";
    if (
      node.tag !== undefined &&
      (tag === "" || tag.length > WORKFLOW_TAG_MAX)
    ) {
      diagnostics.push(
        error(
          "workflow/node-tag",
          `Node "${node.id}" tag must be 1..${WORKFLOW_TAG_MAX} characters.`,
          { nodeId: node.id, path: `/nodes/${index}/tag` },
          [`Shorten the tag on "${node.id}", or drop it.`]
        )
      );
    }
  }

  for (const [index, phase] of (spec.phases ?? []).entries()) {
    if (
      !(Number.isInteger(phase.fromCol) && Number.isInteger(phase.toCol)) ||
      phase.fromCol < 0 ||
      phase.toCol > WORKFLOW_COL_MAX ||
      phase.fromCol > phase.toCol
    ) {
      diagnostics.push(
        error(
          "workflow/phase-span",
          `Phase "${phase.id}" fromCol..toCol must be integers 0..${WORKFLOW_COL_MAX} in order.`,
          { path: `/phases/${index}` },
          [`Set "${phase.id}" to a column range such as fromCol 0, toCol 2.`]
        )
      );
    }
    if (phase.label.trim() === "") {
      diagnostics.push(
        error(
          "workflow/phase-label",
          `Phase "${phase.id}" needs a short label.`,
          { path: `/phases/${index}/label` },
          ["Name the phase, such as Intake."]
        )
      );
    }
  }

  const groups = spec.groups ?? [];
  for (const [index, group] of groups.entries()) {
    if (!laneById.has(group.lane)) {
      diagnostics.push(
        error(
          "workflow/unknown-group-lane",
          `Group "${group.id}" points at unknown lane "${group.lane}".`,
          { path: `/groups/${index}/lane` },
          [
            `Set lane to one of: ${[...laneById.keys()].join(", ") || "(none)"}.`,
          ]
        )
      );
    }
    if (
      !(Number.isInteger(group.fromCol) && Number.isInteger(group.toCol)) ||
      group.fromCol < 0 ||
      group.toCol > WORKFLOW_COL_MAX ||
      group.fromCol > group.toCol
    ) {
      diagnostics.push(
        error(
          "workflow/group-span",
          `Group "${group.id}" fromCol..toCol must be integers 0..${WORKFLOW_COL_MAX} in order.`,
          { path: `/groups/${index}` },
          [`Set "${group.id}" to a column range such as fromCol 2, toCol 3.`]
        )
      );
    }
    if (group.label.trim() === "") {
      diagnostics.push(
        error(
          "workflow/group-label",
          `Group "${group.id}" needs a short label.`,
          { path: `/groups/${index}/label` },
          ["Name the group, such as Planning loop."]
        )
      );
    }
    const covered = spec.nodes.some(
      (node) =>
        node.lane === group.lane &&
        node.col >= group.fromCol &&
        node.col <= group.toCol
    );
    if (!covered) {
      diagnostics.push(
        error(
          "workflow/group-empty",
          `Group "${group.id}" covers no nodes on lane "${group.lane}".`,
          { path: `/groups/${index}` },
          [`Move a node into "${group.id}", or drop the group.`]
        )
      );
    }
    const clash = groups.find(
      (other, otherIndex) =>
        otherIndex < index &&
        other.lane === group.lane &&
        other.fromCol <= group.toCol &&
        group.fromCol <= other.toCol
    );
    if (clash) {
      diagnostics.push(
        error(
          "workflow/group-overlap",
          `Group "${group.id}" overlaps "${clash.id}" on lane "${group.lane}".`,
          { path: `/groups/${index}` },
          [
            `Narrow "${group.id}" so it does not share columns with "${clash.id}".`,
          ]
        )
      );
    }
  }

  if ((spec.notes?.length ?? 0) > 3) {
    diagnostics.push(
      error(
        "workflow/notes-budget",
        "Keep at most three caption notes under the diagram.",
        { path: "/notes" },
        ["Drop the extra notes or merge them."]
      )
    );
  }
  for (const [index, note] of (spec.notes ?? []).entries()) {
    if (note.title.trim() === "" || note.items.length < 1) {
      diagnostics.push(
        error(
          "workflow/note",
          `Note ${index} needs a title and at least one item.`,
          { path: `/notes/${index}` },
          ["Write a title and one or two short facts."]
        )
      );
    }
  }

  for (const [index, edge] of spec.edges.entries()) {
    if (!nodeById.has(edge.from)) {
      diagnostics.push(
        error(
          "workflow/unknown-from",
          `Edge "${edge.id}" from "${edge.from}" is not a node.`,
          { edgeId: edge.id, path: `/edges/${index}/from` },
          ["Point from at an existing node id."]
        )
      );
    }
    if (!nodeById.has(edge.to)) {
      diagnostics.push(
        error(
          "workflow/unknown-to",
          `Edge "${edge.id}" to "${edge.to}" is not a node.`,
          { edgeId: edge.id, path: `/edges/${index}/to` },
          ["Point to at an existing node id."]
        )
      );
    }
  }

  const path = spec.mainPath;
  if (path && path.length > 0) {
    if (path.length < 2) {
      diagnostics.push(
        error(
          "workflow/main-path-short",
          "mainPath needs at least two node ids.",
          { path: "/mainPath" },
          ["List the happy-path nodes in order."]
        )
      );
    }
    for (const [index, id] of path.entries()) {
      const node = nodeById.get(id);
      if (!node) {
        diagnostics.push(
          error(
            "workflow/main-path-node",
            `mainPath refers to unknown node "${id}".`,
            { nodeId: id, path: `/mainPath/${index}` },
            ["Use a node id that exists in nodes."]
          )
        );
        continue;
      }
      const next = path[index + 1];
      if (!next) {
        continue;
      }
      const nextNode = nodeById.get(next);
      if (nextNode && nextNode.col < node.col) {
        diagnostics.push(
          error(
            "workflow/main-path-retreat",
            `mainPath steps from "${id}" (col ${node.col}) back to "${next}" (col ${nextNode.col}).`,
            { nodeId: id, path: `/mainPath/${index}` },
            [
              "Keep the happy path left-to-right, or add a return edge outside mainPath.",
            ],
            { fromCol: node.col, toCol: nextNode.col }
          )
        );
      }
      const linked = spec.edges.some(
        (edge) => edge.from === id && edge.to === next
      );
      if (nodeById.has(next) && !linked) {
        diagnostics.push(
          error(
            "workflow/main-path-edge",
            `mainPath has no edge from "${id}" to "${next}".`,
            { path: `/mainPath/${index}` },
            [`Add an edge { from: "${id}", to: "${next}" } with a short label.`]
          )
        );
      }
    }
  }

  return diagnostics;
}

export function validateWorkflowSpec(
  spec: WorkflowSpec
): WorkflowValidateReceipt {
  const structural = structuralDiagnostics(spec);
  if (structural.some((item) => item.severity === "error")) {
    return { diagnostics: structural, status: 1 };
  }
  const layout = compileWorkflowLayout(spec);
  const diagnostics = [...structural, ...layout.diagnostics];
  if (spec.nodes.length > 12) {
    diagnostics.push({
      code: "workflow/node-budget",
      message: "Ordinary workflows stay at 12 primary nodes or fewer.",
      severity: "warning",
      subject: { path: "/nodes" },
      supportedFixes: [
        "Split a side branch into a second WorkflowDiagram, or drop low-value nodes.",
      ],
    });
  }
  return {
    diagnostics,
    status: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}
