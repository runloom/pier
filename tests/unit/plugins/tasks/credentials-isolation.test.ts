import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pier.tasks credentials stay in plugin main", () => {
  it("does not emit token fields from rpc or events", () => {
    const mainRoot = join(process.cwd(), "packages/plugin-tasks/src/main");
    const rpc = readFileSync(join(mainRoot, "rpc-handlers.ts"), "utf8");
    const poller = readFileSync(join(mainRoot, "poller.ts"), "utf8");
    const credentials = readFileSync(join(mainRoot, "credentials.ts"), "utf8");
    expect(rpc).not.toMatch(/getToken\(\)/);
    expect(poller).not.toMatch(/token/);
    expect(credentials).toContain("secrets.set");
    expect(rpc).not.toMatch(/Authorization/);
  });
});
