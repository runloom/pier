import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

describe("panel capabilities", () => {
  it("accepts panel:register and panel:open", () => {
    expect(pierCapabilitySchema.safeParse("panel:register").success).toBe(true);
    expect(pierCapabilitySchema.safeParse("panel:open").success).toBe(true);
  });
});
