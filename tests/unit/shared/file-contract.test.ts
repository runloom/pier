import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { describe, expect, it } from "vitest";

const root = "/Users/xyz/ABC/pier";

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
        path: "/Users/xyz/ABC/pier/src/renderer",
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
          path: "/Users/xyz/ABC/pier/src/renderer/index.ts",
        }).success
      ).toBe(false);
    }

    expect(
      pierCommandSchema.safeParse({
        newPath: "/Users/xyz/ABC/pier/src/plugins/index.ts",
        path: "src/renderer/index.ts",
        root,
        type: "file.move",
      }).success
    ).toBe(false);
  });
});
