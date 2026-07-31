import {
  FILES_LSP_DEFINITION_TARGET_LIMIT,
  parseFilesLspDefinitions,
} from "@plugins/builtin/files/renderer/lsp/definitions.ts";
import { describe, expect, it } from "vitest";

function range(line: number, startCharacter = 0, endCharacter = 1) {
  return {
    end: { character: endCharacter, line },
    start: { character: startCharacter, line },
  };
}

describe("parseFilesLspDefinitions", () => {
  it("normalizes a single Location", () => {
    const targetRange = range(4, 2, 9);

    expect(
      parseFilesLspDefinitions({
        range: targetRange,
        uri: "file:///repo/src/definition.ts",
      })
    ).toEqual({
      targets: [
        {
          range: targetRange,
          uri: "file:///repo/src/definition.ts",
        },
      ],
      total: 1,
      truncated: false,
    });
  });

  it("normalizes LocationLink and prefers targetSelectionRange", () => {
    const originSelectionRange = range(1, 5, 11);
    const targetRange = range(20, 0, 30);
    const targetSelectionRange = range(21, 7, 16);

    expect(
      parseFilesLspDefinitions({
        originSelectionRange,
        targetRange,
        targetSelectionRange,
        targetUri: "file:///repo/src/linked.ts",
      })
    ).toEqual({
      targets: [
        {
          originSelectionRange,
          range: targetSelectionRange,
          uri: "file:///repo/src/linked.ts",
        },
      ],
      total: 1,
      truncated: false,
    });
  });

  it("falls back to targetRange when a LocationLink has no selection range", () => {
    const targetRange = range(8, 3, 12);

    expect(
      parseFilesLspDefinitions({
        targetRange,
        targetUri: "file:///repo/src/fallback.ts",
      })
    ).toEqual({
      targets: [
        {
          range: targetRange,
          uri: "file:///repo/src/fallback.ts",
        },
      ],
      total: 1,
      truncated: false,
    });
  });

  it("preserves server order across Location and LocationLink entries", () => {
    const firstRange = range(2, 1, 4);
    const secondTargetRange = range(9, 0, 20);
    const secondSelectionRange = range(9, 6, 12);
    const thirdRange = range(30, 3, 8);

    expect(
      parseFilesLspDefinitions([
        { range: firstRange, uri: "file:///repo/first.ts" },
        {
          targetRange: secondTargetRange,
          targetSelectionRange: secondSelectionRange,
          targetUri: "file:///repo/second.ts",
        },
        { range: thirdRange, uri: "file:///repo/third.ts" },
      ])
    ).toEqual({
      targets: [
        { range: firstRange, uri: "file:///repo/first.ts" },
        { range: secondSelectionRange, uri: "file:///repo/second.ts" },
        { range: thirdRange, uri: "file:///repo/third.ts" },
      ],
      total: 3,
      truncated: false,
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 1],
    ["string", "file:///repo/not-a-location.ts"],
    ["empty object", {}],
    ["nested array", [[{ range: range(0), uri: "file:///repo/nested.ts" }]]],
  ])("returns no targets for a malformed top-level %s response", (_name, response) => {
    expect(parseFilesLspDefinitions(response)).toEqual({
      targets: [],
      total: 0,
      truncated: false,
    });
  });

  it("ignores malformed entries without disturbing valid server results", () => {
    const validRange = range(6, 4, 10);

    expect(
      parseFilesLspDefinitions([
        null,
        false,
        { range: validRange },
        { range: validRange, uri: 9 },
        { range: validRange, uri: "" },
        {
          range: {
            start: { character: 0, line: 0 },
          },
          uri: "file:///repo/missing-end.ts",
        },
        {
          range: {
            end: { character: 2, line: 1 },
            start: { character: -1, line: 1 },
          },
          uri: "file:///repo/negative.ts",
        },
        {
          range: {
            end: { character: 2, line: 1.5 },
            start: { character: 0, line: 1 },
          },
          uri: "file:///repo/fractional.ts",
        },
        { targetUri: "file:///repo/missing-target-range.ts" },
        { targetRange: validRange, targetUri: 12 },
        {
          range: validRange,
          uri: "file:///repo/valid.ts",
        },
      ])
    ).toEqual({
      targets: [
        {
          range: validRange,
          uri: "file:///repo/valid.ts",
        },
      ],
      total: 1,
      truncated: false,
    });
  });

  it("deduplicates only exact uri/start/end tuples and keeps the first occurrence", () => {
    const exactRange = range(3, 2, 7);
    const differentEnd = range(3, 2, 8);

    expect(
      parseFilesLspDefinitions([
        {
          range: exactRange,
          uri: "file:///repo/shared.ts",
        },
        {
          originSelectionRange: range(0, 1, 2),
          targetRange: range(3, 0, 20),
          targetSelectionRange: exactRange,
          targetUri: "file:///repo/shared.ts",
        },
        {
          range: differentEnd,
          uri: "file:///repo/shared.ts",
        },
        {
          range: exactRange,
          uri: "file:///repo/other.ts",
        },
      ])
    ).toEqual({
      targets: [
        { range: exactRange, uri: "file:///repo/shared.ts" },
        { range: differentEnd, uri: "file:///repo/shared.ts" },
        { range: exactRange, uri: "file:///repo/other.ts" },
      ],
      total: 3,
      truncated: false,
    });
  });

  it("rejects ranges whose end precedes their start", () => {
    const valid = range(4, 2, 8);

    expect(
      parseFilesLspDefinitions([
        {
          range: {
            end: { character: 7, line: 3 },
            start: { character: 1, line: 4 },
          },
          uri: "file:///repo/reversed-lines.ts",
        },
        {
          range: {
            end: { character: 1, line: 4 },
            start: { character: 7, line: 4 },
          },
          uri: "file:///repo/reversed-characters.ts",
        },
        {
          targetRange: valid,
          targetSelectionRange: {
            end: { character: 2, line: 5 },
            start: { character: 6, line: 5 },
          },
          targetUri: "file:///repo/reversed-selection.ts",
        },
        {
          range: valid,
          uri: "file:///repo/valid.ts",
        },
      ])
    ).toEqual({
      targets: [
        {
          range: valid,
          uri: "file:///repo/valid.ts",
        },
      ],
      total: 1,
      truncated: false,
    });
  });

  it("caps rendered targets at 100 after deduplication while preserving total", () => {
    const uniqueLocations = Array.from(
      { length: FILES_LSP_DEFINITION_TARGET_LIMIT + 3 },
      (_, index) => ({
        range: range(index, index % 5, (index % 5) + 1),
        uri: `file:///repo/definition-${index}.ts`,
      })
    );
    const response = [
      uniqueLocations[0],
      uniqueLocations[0],
      ...uniqueLocations.slice(1),
    ];

    const result = parseFilesLspDefinitions(response);

    expect(FILES_LSP_DEFINITION_TARGET_LIMIT).toBe(100);
    expect(result).toEqual({
      targets: uniqueLocations.slice(0, FILES_LSP_DEFINITION_TARGET_LIMIT),
      total: FILES_LSP_DEFINITION_TARGET_LIMIT + 3,
      truncated: true,
    });
  });

  it("does not report truncation at exactly 100 unique targets", () => {
    const locations = Array.from(
      { length: FILES_LSP_DEFINITION_TARGET_LIMIT },
      (_, index) => ({
        range: range(index),
        uri: `file:///repo/exact-${index}.ts`,
      })
    );

    expect(parseFilesLspDefinitions(locations)).toEqual({
      targets: locations,
      total: FILES_LSP_DEFINITION_TARGET_LIMIT,
      truncated: false,
    });
  });
});
