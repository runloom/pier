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
    syncLspInstallGuides({
      plugins: [
        {
          manifest: {
            apiVersion: 1,
            commands: [],
            engines: { pier: ">=0.1.0" },
            id: "pier.lsp-zig",
            languageServers: [
              {
                command: "zls",
                displayName: "Zig",
                extensions: [".zig"],
                id: "zls",
                installCommand: "brew install zls",
                languageIds: ["zig"],
              },
            ],
            name: "Zig",
            panels: [],
            permissions: ["lsp:provide"],
            settingsPages: [],
            source: { kind: "builtin" },
            terminalStatusItems: [],
            version: "0.1.0",
            workbenchWidgets: [],
          },
          runtime: { enabled: true, kind: "builtin", updatedAt: 0 },
        } as never,
      ],
    });
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

  it("reads Zig install command from plugin guide, not Files hardcoding", () => {
    const guide = lspInstallGuideRegistry.get("pier.lsp-zig:zls");
    expect(guide?.installCommand).toBe("brew install zls");
    expect(guide?.displayName).toBe("Zig");

    const presentation = languageServicePresentation(
      {
        reason: "server-unavailable",
        serverId: "pier.lsp-zig:zls",
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
    expect(presentation.nextStep).not.toMatch(/custom server|自定义语言服务/i);
  });

  it("points no-provider next step at Plugins only (no custom-server UI)", () => {
    const presentation = languageServicePresentation(
      {
        reason: "no-provider",
        state: "unsupported",
      },
      t
    );
    expect(presentation.nextStep).toMatch(/Plugins|插件/i);
    expect(presentation.nextStep).not.toMatch(
      /custom server|自定义语言服务|Settings → Files|设置 → Files/i
    );
  });
});
