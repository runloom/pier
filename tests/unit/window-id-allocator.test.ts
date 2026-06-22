import { WindowIdAllocator } from "@main/windows/window-id-allocator.ts";
import { describe, expect, it } from "vitest";

describe("WindowIdAllocator", () => {
  it("allocates the lowest available w-N id", () => {
    const allocator = new WindowIdAllocator();
    allocator.seed(["main", "w-1", "w-3"]);
    expect(allocator.next()).toBe("w-2");
    expect(allocator.next()).toBe("w-4");
  });

  it("reuses released ids", () => {
    const allocator = new WindowIdAllocator();
    expect(allocator.next()).toBe("w-1");
    expect(allocator.next()).toBe("w-2");
    allocator.release("w-1");
    expect(allocator.next()).toBe("w-1");
  });
});
