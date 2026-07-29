import { lspRequestCommandSchema } from "@shared/contracts/lsp-language-tools.ts";
import { describe, expect, it } from "vitest";

const baseRequest = {
  filePath: "/repo/main.ts",
  params: {},
  rootPath: "/repo",
};

describe("lspRequestCommandSchema", () => {
  it("accepts read-only language queries", () => {
    expect(
      lspRequestCommandSchema.safeParse({
        ...baseRequest,
        method: "textDocument/definition",
      }).success
    ).toBe(true);
  });

  it("rejects methods that can execute commands or mutate files", () => {
    expect(
      lspRequestCommandSchema.safeParse({
        ...baseRequest,
        method: "workspace/executeCommand",
      }).success
    ).toBe(false);
    expect(
      lspRequestCommandSchema.safeParse({
        ...baseRequest,
        method: "textDocument/rename",
      }).success
    ).toBe(false);
  });
});
