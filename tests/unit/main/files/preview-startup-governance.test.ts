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

    expect(bootstrapSource).toContain("handleFilePreviewProtocol()");
    expect(bootstrapSource).toContain("attachLiveModuleProtocolHandler()");
    expect(bootstrapSource).toContain("handleHtmlPreviewProtocol()");
    expect(bootstrapSource).toContain("registerPreviewRequestGuards()");
    expect(bootstrapSource).not.toContain("registerFilePreviewRequestGuard()");
    expect(bootstrapSource).not.toContain("registerHtmlPreviewRequestGuard()");

    // Electron replaces the privileged scheme list on every
    // registerSchemesAsPrivileged call, so bootstrap must register all schemes
    // in a single call; per-scheme registrations would unprivilege the rest.
    expect(
      bootstrapSource.match(/registerSchemesAsPrivileged\(/gu)
    ).toHaveLength(1);
    const schemeFnIndex = bootstrapSource.indexOf(
      "export function registerPrivilegedProtocolSchemes"
    );
    const handlerFnIndex = bootstrapSource.indexOf(
      "export function attachPrivilegedProtocolHandlers"
    );
    const schemeCallIndex = bootstrapSource.indexOf(
      "electronProtocol.registerSchemesAsPrivileged("
    );
    const schemeDescriptors = [
      "assetSchemeRegistration()",
      "pluginAssetSchemeRegistration()",
      "filePreviewSchemeRegistration()",
      "htmlPreviewSchemeRegistration()",
      "liveModuleSchemeRegistration()",
    ];
    expect(schemeFnIndex).toBeGreaterThan(-1);
    expect(handlerFnIndex).toBeGreaterThan(schemeFnIndex);
    expect(schemeCallIndex).toBeGreaterThan(schemeFnIndex);
    expect(schemeCallIndex).toBeLessThan(handlerFnIndex);
    for (const descriptor of schemeDescriptors) {
      const descriptorIndex = bootstrapSource.indexOf(descriptor);
      expect(descriptorIndex).toBeGreaterThan(schemeFnIndex);
      expect(descriptorIndex).toBeLessThan(handlerFnIndex);
    }
    for (const wrapper of [
      "registerAssetScheme()",
      "registerPluginAssetScheme()",
      "registerFilePreviewScheme()",
      "registerHtmlPreviewScheme()",
      "registerLiveModuleProtocolScheme()",
    ]) {
      expect(bootstrapSource).not.toContain(wrapper);
    }

    const filePreviewHandlerIndex = bootstrapSource.indexOf(
      "handleFilePreviewProtocol()"
    );
    const htmlPreviewHandlerIndex = bootstrapSource.indexOf(
      "handleHtmlPreviewProtocol()"
    );
    expect(filePreviewHandlerIndex).toBeGreaterThan(handlerFnIndex);
    expect(htmlPreviewHandlerIndex).toBeGreaterThan(handlerFnIndex);
  });
});
