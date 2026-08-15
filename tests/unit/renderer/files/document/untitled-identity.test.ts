import {
  nextUntitledIdentity,
  resetUntitledIdentityForTests,
  syncNextUntitledIndex,
} from "@plugins/builtin/files/renderer/document/untitled-identity.ts";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  resetUntitledIdentityForTests();
});

describe("untitled identity", () => {
  it("defaults to a typeless name when callers omit nameKind", () => {
    const identity = nextUntitledIdentity({
      idExists: () => false,
      nameExists: () => false,
    });

    expect(identity.name).toBe("Untitled-1");
    expect(identity.index).toBe(1);
  });

  it("allocates a typeless name for a new untitled file", () => {
    const identity = nextUntitledIdentity({
      idExists: () => false,
      nameExists: () => false,
      nameKind: "plain",
    });

    expect(identity.name).toBe("Untitled-1");
    expect(identity.index).toBe(1);
  });

  it("keeps markdown names for temporary markdown documents", () => {
    expect(
      nextUntitledIdentity({
        idExists: () => false,
        nameExists: () => false,
        nameKind: "markdown",
      }).name
    ).toBe("Untitled-1.md");
  });

  it("continues numbering from both plain and markdown restored names", () => {
    syncNextUntitledIndex("pier.files.untitled:a", "Untitled-3");
    syncNextUntitledIndex("pier.files.untitled:b", "Untitled-4.md");

    expect(
      nextUntitledIdentity({
        idExists: () => false,
        nameExists: () => false,
        nameKind: "plain",
      }).name
    ).toBe("Untitled-5");
  });
});
