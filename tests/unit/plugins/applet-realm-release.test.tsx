// @vitest-environment jsdom
import { setLiveModuleRealmImporterForTests } from "@plugins/api/live-module-realm.ts";
import type { RendererLiveModulesApi } from "@plugins/api/live-modules-context.ts";
import { MarkdownAppletFence } from "@plugins/builtin/files/renderer/markdown/applet/fence.tsx";
import { DEFAULT_RENDERER_LABELS } from "@plugins/builtin/files/renderer/markdown/preview-defaults.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ExternalPluginAppletMount } from "@/lib/plugins/external/applet-mount.tsx";

const MODULE_ID = "@pier-applet/pier.tasks/board";
const MODULE_URL = "pier-live://module/abcdefghijklmnopqrstuv";

function failingRealm(): {
  dispose: ReturnType<typeof vi.fn>;
  disposeSoon: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  const disposeSoon = vi.fn();
  setLiveModuleRealmImporterForTests(async () => ({
    dispose,
    disposeSoon,
    namespace: {},
  }));
  return { dispose, disposeSoon };
}

function liveModulesApi(): RendererLiveModulesApi {
  return {
    compile: vi.fn(async () => ({
      graph: [MODULE_ID],
      moduleId: MODULE_ID,
      ok: true as const,
      url: MODULE_URL,
    })),
    getUrl: vi.fn(async () => MODULE_URL),
    grantTrust: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined),
    registerRoot: vi.fn(async () => ({ rootId: "root-1" })),
    revokeTrust: vi.fn(async () => undefined),
    trustStatus: vi.fn(async () => ({
      grantedAt: "2026-01-01T00:00:00.000Z",
      trusted: true,
    })),
    unregisterRoot: vi.fn(async () => ({ rootId: "root-1" })),
  };
}

describe("applet realm release on mount failure", () => {
  const originalPier = window.pier;

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    setLiveModuleRealmImporterForTests(null);
    window.pier = originalPier;
    vi.restoreAllMocks();
  });

  it("disposes the plugin applet realm when mount throws", async () => {
    const { disposeSoon } = failingRealm();
    window.pier = {
      liveModules: liveModulesApi(),
    } as unknown as typeof window.pier;

    render(
      <ExternalPluginAppletMount
        appletId="board"
        pluginId="pier.tasks"
        projectRootPath="/repo"
      />
    );

    await waitFor(() => {
      expect(disposeSoon).toHaveBeenCalled();
    });
  });

  it("disposes the markdown applet realm when mount throws", async () => {
    const { disposeSoon } = failingRealm();
    render(
      <MarkdownAppletFence
        disk={{ kind: "disk", path: "notes.md", root: "/repo" }}
        enabled
        labels={DEFAULT_RENDERER_LABELS}
        liveModules={liveModulesApi()}
        source={JSON.stringify({
          appletId: "board",
          pluginId: "pier.tasks",
        })}
      />
    );

    await waitFor(() => {
      expect(disposeSoon).toHaveBeenCalled();
    });
  });
});
