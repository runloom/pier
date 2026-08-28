import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  pierCapabilitySchema,
} from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

describe("managedAssets:write capability", () => {
  it("is a known capability", () => {
    expect(pierCapabilitySchema.safeParse("managedAssets:write").success).toBe(
      true
    );
  });

  it("is granted to desktop-renderer only", () => {
    const granted = (
      Object.entries(DEFAULT_CAPABILITIES_BY_CLIENT_KIND) as [
        string,
        readonly string[],
      ][]
    )
      .filter(([, caps]) => caps.includes("managedAssets:write"))
      .map(([kind]) => kind);
    expect(granted).toEqual(["desktop-renderer"]);
  });
});
