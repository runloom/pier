// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildSandboxDocumentCsp,
  buildSandboxSrcDoc,
  isSandboxSrcDocHref,
  SandboxIframeHost,
} from "@/lib/plugins/sandbox/iframe-host.tsx";

vi.mock("@/i18n/use-t.ts", () => ({
  useT: () => (key: string) => key,
}));

describe("sandbox iframe host (Phase 2 M2)", () => {
  it("builds bootstrap doc carrying the token, bundle url and hello protocol", () => {
    const doc = buildSandboxSrcDoc({
      bundleUrl: "pier-plugin://third.demo/1.0.0/dist/renderer.js",
      token: "tok_123",
    });
    expect(doc).toContain("pier-plugin://third.demo/1.0.0/dist/renderer.js");
    expect(doc).toContain("tok_123");
    expect(doc).toContain('t: "hello"');
    expect(doc).toContain("{ ...frame, token: TOKEN }");
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("script-src 'unsafe-inline'");
    // 插件脚本经 script.src 注入 —— 文档本身不内联第三方代码。
    expect(doc).toContain("script.src =");
  });

  it("allowlists only the bootstrap inline script and the concrete bundle URL", () => {
    const bundleUrl = "pier-plugin://third.demo/1.0.0/dist/renderer.js";
    const csp = buildSandboxDocumentCsp(bundleUrl);
    expect(csp).toBe(
      `default-src 'none'; script-src 'unsafe-inline' ${bundleUrl}; connect-src 'none'`
    );
    expect(isSandboxSrcDocHref("about:srcdoc")).toBe(true);
    expect(isSandboxSrcDocHref("https://evil.example/")).toBe(false);
  });

  it("renders a sandboxed iframe without allow-same-origin", () => {
    const methods = new Map();
    const { container } = render(
      <SandboxIframeHost
        allowedChannels={[]}
        bundleUrl="pier-plugin://third.demo/1.0.0/dist/renderer.js"
        grantedCapabilities={["file:read"]}
        methods={methods}
        pluginId="third.demo"
        title="demo"
        token="tok_smoke"
      />
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    // 无 allow-same-origin ⇒ opaque origin：插件摸不到宿主 DOM。
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("csp") ?? "").toContain("default-src 'none'");
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain("tok_smoke");
  });
});
