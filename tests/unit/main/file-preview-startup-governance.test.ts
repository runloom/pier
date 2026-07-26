import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("file preview startup governance", () => {
  it("registers privileged schemes before app readiness and handlers afterward", async () => {
    const indexSource = await readFile(
      join(process.cwd(), "src/main/index.ts"),
      "utf8"
    );
    const bootstrapSource = await readFile(
      join(process.cwd(), "src/main/bootstrap-privileged-protocols.ts"),
      "utf8"
    );

    const registerCallIndex = indexSource.indexOf(
      "registerPrivilegedProtocolSchemes()"
    );
    const readyIndex = indexSource.indexOf("app.whenReady()");
    const attachCallIndex = indexSource.indexOf(
      "attachPrivilegedProtocolHandlers("
    );

    expect(registerCallIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(registerCallIndex);
    expect(attachCallIndex).toBeGreaterThan(readyIndex);

    expect(bootstrapSource).toContain("registerFilePreviewScheme()");
    expect(bootstrapSource).toContain("handleFilePreviewProtocol()");
    expect(bootstrapSource).toContain("registerLiveModuleProtocolScheme()");
    expect(bootstrapSource).toContain("attachLiveModuleProtocolHandler()");

    const schemeFnIndex = bootstrapSource.indexOf(
      "export function registerPrivilegedProtocolSchemes"
    );
    const handlerFnIndex = bootstrapSource.indexOf(
      "export function attachPrivilegedProtocolHandlers"
    );
    const filePreviewSchemeIndex = bootstrapSource.indexOf(
      "registerFilePreviewScheme()"
    );
    const filePreviewHandlerIndex = bootstrapSource.indexOf(
      "handleFilePreviewProtocol()"
    );

    expect(schemeFnIndex).toBeGreaterThan(-1);
    expect(handlerFnIndex).toBeGreaterThan(schemeFnIndex);
    expect(filePreviewSchemeIndex).toBeGreaterThan(schemeFnIndex);
    expect(filePreviewSchemeIndex).toBeLessThan(handlerFnIndex);
    expect(filePreviewHandlerIndex).toBeGreaterThan(handlerFnIndex);
  });
});
