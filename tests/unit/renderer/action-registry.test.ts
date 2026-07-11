import { CORE_RESERVED_ACTION_IDS } from "@shared/plugin-core-contribution-ids.ts";
import { describe, expect, it, vi } from "vitest";
import { ALL_ACTION_CONTRIBUTIONS } from "@/lib/actions/all-action-contributions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";

describe("action registry ownership", () => {
  it("keeps the main-process reserved ids equal to every core action", () => {
    const coreIds = ALL_ACTION_CONTRIBUTIONS.map((action) => action.id).sort();
    const reservedIds = [...CORE_RESERVED_ACTION_IDS].sort();

    expect(new Set(coreIds).size).toBe(coreIds.length);
    expect(reservedIds).toEqual(coreIds);
  });

  it("rejects duplicate ids and lets only the owner disposer remove an action", () => {
    const id = `test.action.${crypto.randomUUID()}`;
    const owner = {
      category: "Test",
      handler: vi.fn(),
      id,
      title: () => "Owner",
    };
    const dispose = actionRegistry.register(owner);

    expect(() =>
      actionRegistry.register({ ...owner, handler: vi.fn() })
    ).toThrow("action id is already registered");
    expect(actionRegistry.get(id)).toBe(owner);

    dispose();
    expect(actionRegistry.get(id)).toBeUndefined();
  });
});
