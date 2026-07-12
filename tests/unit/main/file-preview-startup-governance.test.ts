import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("file preview startup governance", () => {
  it("registers the scheme before app readiness and the handler afterward", async () => {
    const source = await readFile(
      join(process.cwd(), "src/main/index.ts"),
      "utf8"
    );
    const registerIndex = source.indexOf("registerFilePreviewScheme()");
    const readyIndex = source.indexOf("app.whenReady()");
    const handlerIndex = source.indexOf("handleFilePreviewProtocol()");

    expect(registerIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(registerIndex);
    expect(handlerIndex).toBeGreaterThan(readyIndex);
  });
});
