import type {
  CanvasMaterialCatalogEntry,
  CanvasMaterialNestedType,
  CanvasMaterialProp,
} from "./types.ts";

function attr(
  name: string,
  type: string,
  key: string,
  defaultValue?: string
): CanvasMaterialProp {
  return {
    ...(defaultValue === undefined ? {} : { defaultValue }),
    descriptionKey: `settings.materials.prop.${key}`,
    name,
    type,
  };
}

const READ_RESULT: CanvasMaterialNestedType = {
  name: "CanvasFileReadResult",
  props: [
    attr("contents", "string", "fileContents"),
    attr("revision", "string", "fileRevision"),
  ],
  signature: [
    "interface CanvasFileReadResult {",
    "  contents: string",
    "  revision: string",
    "}",
  ].join("\n"),
};

const WRITE_OUTCOME: CanvasMaterialNestedType = {
  name: "CanvasFileWriteOutcome",
  props: [
    attr(
      "written",
      '{ kind: "written"; revision: string }',
      "fileWriteWritten"
    ),
    attr(
      "conflict",
      '{ kind: "conflict"; message: string }',
      "fileWriteConflict"
    ),
    attr("failed", '{ kind: "failed"; message: string }', "fileWriteFailed"),
  ],
  signature: [
    "type CanvasFileWriteOutcome =",
    '  | { kind: "written"; revision: string }',
    '  | { kind: "conflict"; message: string }',
    '  | { kind: "failed"; message: string }',
  ].join("\n"),
};

/** Canvas sibling-file sandbox. Not the global `file.*` host commands. */
export const DATA_CATALOG_ENTRIES: Record<string, CanvasMaterialCatalogEntry> =
  {
    canvasFile: {
      nestedTypes: [READ_RESULT, WRITE_OUTCOME],
      parameters: [],
      props: [
        attr("available", "boolean", "fileAvailable"),
        attr("directory", "string", "fileDirectory"),
        attr(
          "read",
          "(fileName: string) => Promise<CanvasFileReadResult>",
          "fileRead"
        ),
        attr(
          "write",
          "(fileName: string, contents: string, expectedRevision: string | null) => Promise<CanvasFileWriteOutcome>",
          "fileWrite"
        ),
      ],
      returnsSignature: [
        "interface CanvasFileApi {",
        "  available: boolean",
        "  directory: string",
        "  read(fileName: string): Promise<CanvasFileReadResult>",
        "  write(",
        "    fileName: string,",
        "    contents: string,",
        "    expectedRevision: string | null",
        "  ): Promise<CanvasFileWriteOutcome>",
        "}",
      ].join("\n"),
      signature: "function useCanvasFile(): CanvasFileApi",
      usage: [
        "const file = useCanvasFile()",
        "if (!file.available) {",
        "  return",
        "}",
        'const { contents, revision } = await file.read("data.json")',
        'const outcome = await file.write("data.json", contents, revision)',
        'if (outcome.kind === "conflict") {',
        '  await file.read("data.json")',
        "}",
      ].join("\n"),
    },
    activityOverview: {
      nestedTypes: [
        {
          name: "CanvasActivityCounts",
          props: [
            attr("inProgress", "number", "aoInProgress"),
            attr("needsYou", "number", "aoNeedsYou"),
            attr("running", "number", "aoRunning"),
          ],
          signature: [
            "interface CanvasActivityCounts {",
            "  inProgress: number",
            "  needsYou: number",
            "  running: number",
            "}",
          ].join("\n"),
        },
        {
          name: "CanvasActivityRow",
          props: [
            attr("kind", '"agent" | "shell" | "task"', "aoKind"),
            attr("panelId", "string", "aoPanelId"),
            attr("updatedAt", "number", "aoUpdatedAt"),
          ],
          signature: [
            "interface CanvasActivityRow {",
            '  kind: "agent" | "shell" | "task"',
            "  panelId: string",
            "  updatedAt: number",
            "}",
          ].join("\n"),
        },
      ],
      parameters: [],
      props: [
        attr("counts", "CanvasActivityCounts", "aoCounts"),
        attr("rows", "CanvasActivityRow[]", "aoRows"),
      ],
      returnsSignature: [
        "interface CanvasActivityOverview {",
        "  counts: CanvasActivityCounts",
        "  rows: CanvasActivityRow[]",
        "}",
      ].join("\n"),
      signature: "function useActivityOverview(): CanvasActivityOverview",
      usage: [
        "const overview = useActivityOverview()",
        "return (",
        '  <Text tone="secondary">',
        "    {overview.counts.running} running ·",
        "    {overview.counts.needsYou} need you",
        "  </Text>",
        ")",
      ].join("\n"),
    },
    costOverview: {
      nestedTypes: [],
      parameters: [],
      props: [
        attr("refresh", "() => Promise<void>", "coRefresh"),
        attr("snapshot", "object | null", "coSnapshot"),
        attr("status", '"error" | "loading" | "ready"', "coStatus"),
      ],
      returnsSignature: [
        "interface CanvasCostOverview {",
        "  refresh(): Promise<void>",
        "  snapshot: object | null",
        '  status: "error" | "loading" | "ready"',
        "}",
      ].join("\n"),
      signature: "function useCostOverview(): CanvasCostOverview",
      usage: [
        "const cost = useCostOverview()",
        'if (cost.status !== "ready") {',
        "  return <Spinner />",
        "}",
        "return <Button onClick={() => cost.refresh()}>Refresh</Button>",
      ].join("\n"),
    },
    systemResources: {
      nestedTypes: [],
      parameters: [],
      props: [
        attr(
          "cpuHistory",
          "readonly { ts: number; value: number }[]",
          "srCpuHistory"
        ),
        attr("error", "string | null", "srError"),
        attr("snapshot", "object | null", "srSnapshot"),
        attr("status", '"error" | "loading" | "ready"', "srStatus"),
      ],
      returnsSignature: [
        "interface CanvasSystemResources {",
        "  cpuHistory: readonly { ts: number; value: number }[]",
        "  error: string | null",
        "  snapshot: object | null",
        '  status: "error" | "loading" | "ready"',
        "}",
      ].join("\n"),
      signature: "function useSystemResources(): CanvasSystemResources",
      usage: [
        "const resources = useSystemResources()",
        "const latest = resources.cpuHistory.at(-1)",
        'return <Text>{latest ? latest.value + "%" : "…"}</Text>',
      ].join("\n"),
    },
  };
