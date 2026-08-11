import { readFileSync } from "node:fs";
import { join } from "node:path";
import { managedPluginPackageManifestSchema } from "@shared/contracts/plugin/managed.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

const base = {
  apiVersion: 1 as const,
  engines: { pier: ">=0.1.0" },
  id: "pier.lsp-java",
  name: "Java Language Service",
  source: { kind: "builtin" as const },
  version: "0.1.0",
};

describe("plugin languageServers contribution", () => {
  it("accepts languageServers when lsp:provide is granted", () => {
    const parsed = pluginManifestSchema.safeParse({
      ...base,
      languageServers: [
        {
          command: "jdtls",
          displayName: "Java",
          extensions: [".java"],
          id: "jdtls",
          languageIds: ["java"],
        },
      ],
      permissions: ["lsp:provide"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.languageServers ?? []).toHaveLength(1);
      expect(parsed.data.languageServers?.[0]?.priority).toBe(70);
    }
  });

  it("rejects languageServers without lsp:provide", () => {
    const parsed = pluginManifestSchema.safeParse({
      ...base,
      languageServers: [
        {
          command: "jdtls",
          displayName: "Java",
          extensions: [".java"],
          id: "jdtls",
          languageIds: ["java"],
        },
      ],
      permissions: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate languageServer ids", () => {
    const contribution = {
      command: "jdtls",
      displayName: "Java",
      extensions: [".java"],
      id: "jdtls",
      languageIds: ["java"],
    };
    const parsed = pluginManifestSchema.safeParse({
      ...base,
      languageServers: [contribution, contribution],
      permissions: ["lsp:provide"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("plugin languageModes contribution", () => {
  it("parses managed pier.lsp-zig package modes + servers pack", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/plugin-lsp-zig/plugin.json"),
        "utf8"
      )
    ) as unknown;
    const parsed = managedPluginPackageManifestSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.id).toBe("pier.lsp-zig");
    expect(parsed.data.languageModes ?? []).toHaveLength(1);
    expect(parsed.data.languageServers ?? []).toHaveLength(1);
    expect(parsed.data.permissions).toEqual(
      expect.arrayContaining(["lsp:provide", "languageMode:provide"])
    );
  });

  it("accepts languageModes when languageMode:provide is granted", () => {
    const parsed = pluginManifestSchema.safeParse({
      ...base,
      languageModes: [
        {
          displayName: "Zig",
          extensions: [".zig"],
          highlight: "clike",
          id: "zig",
          languageId: "zig",
        },
      ],
      permissions: ["languageMode:provide"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.languageModes ?? []).toHaveLength(1);
      expect(parsed.data.languageModes?.[0]?.highlight).toBe("clike");
    }
  });

  it("rejects languageModes without languageMode:provide", () => {
    const parsed = pluginManifestSchema.safeParse({
      ...base,
      languageModes: [
        {
          displayName: "Zig",
          extensions: [".zig"],
          highlight: "clike",
          id: "zig",
        },
      ],
      permissions: [],
    });
    expect(parsed.success).toBe(false);
  });
});
