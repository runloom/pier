import { describe, expect, it } from "vitest";
import { parseDarwinVmStatAvailableBytes } from "../../../../src/main/services/pier-resource/host-memory.ts";

describe("parseDarwinVmStatAvailableBytes", () => {
  it("sums free + inactive + speculative + purgeable", () => {
    const output = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               1000.
Pages active:                            50000.
Pages inactive:                          2000.
Pages speculative:                        100.
Pages wired down:                        10000.
Pages purgeable:                          400.
`;
    // (1000+2000+100+400)*16384
    expect(parseDarwinVmStatAvailableBytes(output, 4096)).toBe(3500 * 16_384);
  });

  it("falls back to pageSizeFallback when header missing", () => {
    const output = `
Pages free:                               10.
Pages inactive:                           5.
Pages speculative:                        0.
Pages purgeable:                          0.
`;
    expect(parseDarwinVmStatAvailableBytes(output, 4096)).toBe(15 * 4096);
  });
});
