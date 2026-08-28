import {
  memoryDeleteObservationRequestSchema,
  memoryListResultSchema,
} from "@shared/contracts/agent/memory.ts";
import { describe, expect, it } from "vitest";

const validConventionItem = {
  entityName: "naming",
  entityType: "convention",
  index: 0,
  observation: "prefer kebab-case",
};

describe("memory list/delete contracts", () => {
  it("memoryListResultSchema.parse valid convention item → items length 1", () => {
    const parsed = memoryListResultSchema.parse({
      items: [validConventionItem],
      tooLarge: false,
    });
    expect(parsed.items).toHaveLength(1);
  });

  it('entityType "note" → safeParse success false', () => {
    const result = memoryListResultSchema.safeParse({
      items: [{ ...validConventionItem, entityType: "note" }],
      tooLarge: false,
    });
    expect(result.success).toBe(false);
  });

  it("memoryDeleteObservationRequestSchema.safeParse with entityName, index 0, observation, project root succeeds", () => {
    const result = memoryDeleteObservationRequestSchema.safeParse({
      entityName: "naming",
      index: 0,
      observation: "prefer kebab-case",
      root: { projectRootPath: "/r", scope: "project" },
    });
    expect(result.success).toBe(true);
  });

  it("delete request without observation text is rejected", () => {
    const result = memoryDeleteObservationRequestSchema.safeParse({
      entityName: "naming",
      index: 0,
      root: { projectRootPath: "/r", scope: "project" },
    });
    expect(result.success).toBe(false);
  });
});
