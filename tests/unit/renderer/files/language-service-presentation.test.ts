import { languageServicePresentation } from "@plugins/builtin/files/renderer/panel/language-service-presentation.ts";
import { lspInstallGuideRegistry } from "@plugins/builtin/files/renderer/panel/lsp-install-guide-registry.ts";
import { syncLspInstallGuides } from "@plugins/builtin/files/renderer/panel/sync-lsp-install-guides.ts";
import { beforeEach, describe, expect, it } from "vitest";

const t = (
  key: string,
  fallback?: string,
  values?: Record<string, number | string>
): string => {
  let text = fallback ?? key;
  if (values) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
  }
  return text;
};

describe("languageServicePresentation", () => {
  beforeEach(() => {
    // Default core catalog = full L0 matrix (scheme A). No language plugins.
    syncLspInstallGuides({});
  });

  it("sync with empty input still registers matrix install guides", () => {
    expect(lspInstallGuideRegistry.get("pyright")?.installCommand).toBe(
      "npm i -g pyright"
    );
    expect(lspInstallGuideRegistry.get("css")?.installCommand).toBe(
      "npm i -g vscode-langservers-extracted"
    );
    expect(lspInstallGuideRegistry.get("clangd")?.installCommand).toBe(
      "brew install llvm"
    );
    expect(lspInstallGuideRegistry.get("zls")?.installCommand).toBe(
      "brew install zls"
    );
    expect(lspInstallGuideRegistry.get("svelte")?.installCommand).toBe(
      "npm i -g svelte-language-server"
    );
    expect(lspInstallGuideRegistry.get("astro")?.installCommand).toBe(
      "npm i -g @astrojs/language-server"
    );
    expect(lspInstallGuideRegistry.get("graphql")?.installCommand).toBe(
      "npm i -g graphql-language-service-cli graphql"
    );
    expect(lspInstallGuideRegistry.get("terraform-ls")?.installCommand).toBe(
      "brew install terraform-ls"
    );
  });

  it("explains missing CSS server with install command", () => {
    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "css",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Not installed");
    expect(presentation.tone).toBe("warning");
    expect(presentation.title).toContain("CSS");
    expect(presentation.command).toBe("npm i -g vscode-langservers-extracted");
    expect(presentation.nextStep).toMatch(/Install|restart/i);
  });

  it("keeps failure tone for retry exhausted", () => {
    const presentation = languageServicePresentation(
      {
        reason: "retry-exhausted",
        serverId: "pyright",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Failed");
    expect(presentation.tone).toBe("danger");
    expect(presentation.command).toBe("npm i -g pyright");
  });

  it("guides user to settings when globally disabled", () => {
    const presentation = languageServicePresentation(
      {
        reason: "globally-disabled",
        state: "disabled",
      },
      t
    );
    expect(presentation.nextStep).toMatch(/Settings/i);
  });

  it("explains missing Vue server with install command", () => {
    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "vue",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Not installed");
    expect(presentation.command).toBe("npm i -g @vue/language-server");
    expect(presentation.title).toContain("Vue");
  });

  it("surfaces Vue install command when retries are exhausted", () => {
    const presentation = languageServicePresentation(
      {
        reason: "retry-exhausted",
        serverId: "vue",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Failed");
    expect(presentation.command).toBe("npm i -g @vue/language-server");
  });

  it("explains missing Svelte server with install command", () => {
    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "svelte",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Not installed");
    expect(presentation.command).toBe("npm i -g svelte-language-server");
    expect(presentation.title).toContain("Svelte");
  });

  it("explains missing Astro server with install command", () => {
    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "astro",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Not installed");
    expect(presentation.command).toBe("npm i -g @astrojs/language-server");
    expect(presentation.title).toContain("Astro");
  });

  it("reads Zig install command from core matrix guide id zls", () => {
    const guide = lspInstallGuideRegistry.get("zls");
    expect(guide?.installCommand).toBe("brew install zls");
    expect(guide?.displayName).toBe("Zig");

    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "zls",
        state: "error",
      },
      t
    );
    expect(presentation.label).toBe("Not installed");
    expect(presentation.title).toContain("Zig");
    expect(presentation.command).toBe("brew install zls");
    expect(presentation.nextStep).toMatch(
      /Install|terminal|restart|终端|重启/i
    );
    expect(presentation.nextStep).not.toMatch(
      /custom server|自定义语言服务|Plugins|插件/i
    );
  });

  it("points no-provider next step at PATH tools, not plugins", () => {
    const presentation = languageServicePresentation(
      {
        reason: "no-provider",
        state: "unsupported",
      },
      t
    );
    expect(presentation.nextStep).toMatch(/PATH|language server|语言服务器/i);
    expect(presentation.nextStep).not.toMatch(
      /custom server|自定义语言服务|Plugins|插件/i
    );
  });

  it("server-unavailable without guide still avoids Plugins copy", () => {
    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "unknown-core-server",
        state: "error",
      },
      t
    );
    expect(presentation.command).toBeUndefined();
    expect(presentation.nextStep).toMatch(/PATH|Local tools|本机工具|Files/i);
    expect(presentation.nextStep).not.toMatch(/Plugins|插件/i);
  });
});
