import { describe, expect, it } from "vitest";
import { createBootstrappedLspRegistry } from "../../../../src/main/services/lsp/bootstrap-providers.ts";
import {
  languageIdForEnsure,
  resolveEnsureProvider,
} from "../../../../src/main/services/lsp/resolve-provider.ts";

describe("resolveEnsureProvider", () => {
  it("matches by language override instead of the file path", () => {
    const registry = createBootstrappedLspRegistry();
    const provider = resolveEnsureProvider(registry, {
      filePath: "/repo/notes.txt",
      languageId: "typescript",
    });
    expect(provider?.id).toBe("typescript");
    expect(
      languageIdForEnsure(provider!, {
        filePath: "/repo/notes.txt",
        languageId: "typescript",
      })
    ).toBe("typescript");
  });

  it("returns no provider when Plain Text is picked", () => {
    const registry = createBootstrappedLspRegistry();
    expect(
      resolveEnsureProvider(registry, {
        filePath: "/repo/src/file.ts",
        languageId: "text",
      })
    ).toBeNull();
  });

  it("keeps path-based languageId when no override is sent", () => {
    const registry = createBootstrappedLspRegistry();
    const provider = resolveEnsureProvider(registry, {
      filePath: "/repo/src/file.tsx",
    });
    expect(provider?.id).toBe("typescript");
    expect(
      languageIdForEnsure(provider!, { filePath: "/repo/src/file.tsx" })
    ).toBe("typescriptreact");
  });
});
