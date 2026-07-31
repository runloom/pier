import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { fileDocumentReadResultSchema } from "@shared/contracts/file.ts";
import { describe, expect, it } from "vitest";

const root = "/Users/dev/ABC/pier";

describe("shared file contract", () => {
  it("parses file.list with a non-empty root and root-relative path", () => {
    expect(
      pierCommandSchema.parse({
        path: "src/renderer",
        root,
        type: "file.list",
      })
    ).toMatchObject({
      path: "src/renderer",
      root,
      type: "file.list",
    });

    expect(
      pierCommandSchema.safeParse({
        path: "src/renderer",
        root: "",
        type: "file.list",
      }).success
    ).toBe(false);

    expect(
      pierCommandSchema.safeParse({
        path: "/Users/dev/ABC/pier/src/renderer",
        root,
        type: "file.list",
      }).success
    ).toBe(false);
  });

  it("keeps file read/write commands scoped to a root and root-relative paths", () => {
    const scopedCommands = [
      {
        path: "src/renderer/index.ts",
        root,
        type: "file.readText",
      },
      {
        contents: "export const value = 1;\n",
        path: "src/renderer/index.ts",
        root,
        type: "file.writeText",
      },
      {
        newPath: "src/plugins/index.ts",
        path: "src/renderer/index.ts",
        root,
        type: "file.move",
      },
      {
        path: "src/renderer/index.ts",
        root,
        type: "file.trash",
      },
    ];

    for (const command of scopedCommands) {
      expect(pierCommandSchema.parse(command)).toMatchObject(command);
      expect(
        pierCommandSchema.safeParse({ ...command, root: "" }).success
      ).toBe(false);
      expect(
        pierCommandSchema.safeParse({
          ...command,
          path: "/Users/dev/ABC/pier/src/renderer/index.ts",
        }).success
      ).toBe(false);
    }

    expect(
      pierCommandSchema.safeParse({
        newPath: "/Users/dev/ABC/pier/src/plugins/index.ts",
        path: "src/renderer/index.ts",
        root,
        type: "file.move",
      }).success
    ).toBe(false);
  });

  it("validates revision-safe document commands as discriminated contracts", () => {
    expect(
      pierCommandSchema.parse({
        path: "src/index.ts",
        root,
        type: "file.readDocument",
      })
    ).toMatchObject({ type: "file.readDocument" });
    expect(
      pierCommandSchema.parse({
        contents: "const value = 1;\n",
        eol: "lf",
        expected: { kind: "revision", revision: "opaque-revision" },
        format: { bom: false, encoding: "utf8" },
        path: "src/index.ts",
        root,
        type: "file.writeDocument",
      })
    ).toMatchObject({ type: "file.writeDocument" });
    expect(
      pierCommandSchema.parse({
        path: "src/index.ts",
        root,
        type: "file.inspectWriteTarget",
      })
    ).toMatchObject({ type: "file.inspectWriteTarget" });
    expect(
      pierCommandSchema.parse({
        expectedRevision: "opaque-revision",
        path: "src/index.ts",
        root,
        type: "file.confirmDurability",
      })
    ).toMatchObject({ type: "file.confirmDurability" });

    for (const command of [
      {
        contents: "x",
        eol: "mixed",
        expected: { kind: "absent" },
        format: { bom: false, encoding: "utf16le" },
        path: "src/index.ts",
        root,
        type: "file.writeDocument",
      },
      {
        expectedRevision: "",
        path: "src/index.ts",
        root,
        type: "file.confirmDurability",
      },
    ]) {
      expect(pierCommandSchema.safeParse(command).success).toBe(false);
    }
  });

  it("keeps image read results metadata-only without an IPC payload", () => {
    const image = {
      canonicalPath: "assets/image.png",
      kind: "image",
      mime: "image/png",
      mtimeMs: 1,
      path: "assets/image.png",
      revision: "file-v1:revision",
      root,
      size: 8,
    };

    expect(fileDocumentReadResultSchema.parse(image)).toEqual(image);
    expect(
      fileDocumentReadResultSchema.safeParse({ ...image, bytes: [137, 80] })
        .success
    ).toBe(false);
    expect(
      fileDocumentReadResultSchema.safeParse({ ...image, base64: "iVBORw==" })
        .success
    ).toBe(false);
  });
});
