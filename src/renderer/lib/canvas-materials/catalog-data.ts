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
  };
