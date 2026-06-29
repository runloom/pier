import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ALL_ACTION_CONTRIBUTIONS } from "@/lib/actions/all-action-contributions.ts";
import { createActionFromContribution } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContributionRuntime } from "@/lib/actions/contribution-types.ts";
import type { Action } from "@/lib/actions/types.ts";
import {
  buildActionSearchDocument,
  rankActionSearchDocuments,
} from "@/lib/search/action-search.ts";
import type { SearchDocument } from "@/lib/search/types.ts";

const action = (
  id: string,
  title: string,
  aliases: readonly string[] = []
): Action => ({
  id,
  category: "Panel",
  handler: () => undefined,
  metadata: {
    aliases: () => aliases,
  },
  surfaces: ["command-palette"],
  title: () => title,
});

const runtime: ActionContributionRuntime = {
  getContext: () => ({
    terminal: {
      hasActivePanel: true,
    },
    workspace: {
      activeGroupPanelCount: 2,
      groupCount: 2,
      hasActivePanel: true,
      hasApi: true,
      panelCount: 3,
    },
  }),
  resolveAliases: (key) => {
    const value = i18next.t(key, { returnObjects: true });
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  },
  t: (key) => i18next.t(key),
};

function contributedActionIdsFor(query: string): string[] {
  const documents = ALL_ACTION_CONTRIBUTIONS.map((contribution) =>
    buildActionSearchDocument(
      createActionFromContribution(contribution, runtime)
    )
  );
  return rankActionSearchDocuments(documents, query).map(
    (result) => result.document.id
  );
}

describe("action search", () => {
  beforeAll(async () => {
    await initI18n();
  });

  it.each([
    "均分",
    "平分",
    "equalize",
    "balance",
    "junfen",
    "jfmb",
    "pier.panel.equalizeSplits",
  ])("matches equalize panels by title, aliases, pinyin, shortcut, or id: %s", (query) => {
    const doc = buildActionSearchDocument(
      action("pier.panel.equalizeSplits", "均分面板", [
        "平分面板",
        "equalize panels",
        "balance panels",
        "junfen",
        "jfmb",
      ]),
      { shortcutLabel: "Cmd+Shift+=" }
    );

    expect(rankActionSearchDocuments([doc], query)[0]?.document.id).toBe(
      "pier.panel.equalizeSplits"
    );
  });

  it("ranks exact and prefix visible-text matches ahead of fuzzy matches", () => {
    const docs: SearchDocument<Action>[] = [
      buildActionSearchDocument(
        action("pier.panel.fuzzyOnly", "Panels Balance")
      ),
      buildActionSearchDocument(
        action("pier.panel.exactAlias", "Distribute Layout", ["balance panels"])
      ),
      buildActionSearchDocument(
        action("pier.panel.prefixTitle", "Balance Panels Quickly")
      ),
    ];

    expect(
      rankActionSearchDocuments(docs, "balance panels").map(
        (result) => result.document.id
      )
    ).toEqual([
      "pier.panel.exactAlias",
      "pier.panel.prefixTitle",
      "pier.panel.fuzzyOnly",
    ]);
  });

  it("keeps disabled actions visible but marked as disabled", () => {
    const doc = buildActionSearchDocument(
      {
        ...action("pier.panel.equalizeSplits", "均分面板", ["balance panels"]),
        enabled: () => false,
      },
      { disabled: true }
    );

    const result = rankActionSearchDocuments([doc], "balance")[0];

    expect(result?.document.id).toBe("pier.panel.equalizeSplits");
    expect(result?.document.disabled).toBe(true);
  });

  it("does not include legacy metadata keywords in search documents", () => {
    const legacyAction = {
      ...action("pier.config.theme", "Select Theme"),
      metadata: {
        keywords: ["legacy-theme-keyword"],
      },
    } as unknown as Action;
    const doc = buildActionSearchDocument(legacyAction);

    expect(doc.aliases).toEqual([]);
    expect(rankActionSearchDocuments([doc], "legacy-theme-keyword")).toEqual(
      []
    );
  });

  it.each([
    ["主题", "pier.config.theme"],
    ["theme", "pier.config.theme"],
    ["dark", "pier.config.theme"],
    ["shense", "pier.config.theme"],
    ["style", "pier.config.stylePreset"],
    ["配色", "pier.config.stylePreset"],
    ["fengge", "pier.config.stylePreset"],
    ["language", "pier.config.locale"],
    ["中文", "pier.config.locale"],
    ["zh", "pier.config.locale"],
    ["jianti", "pier.config.locale"],
    ["fangda", "pier.view.zoomIn"],
    ["suoxiao", "pier.view.zoomOut"],
    ["chongzhi suofang", "pier.view.resetZoom"],
    ["terminal list", "pier.run.terminalList"],
    ["终端列表", "pier.run.terminalList"],
    ["session", "pier.run.terminalList"],
    ["reset layout", "pier.workspace.resetLayout"],
    ["重置布局", "pier.workspace.resetLayout"],
    ["junfen", "pier.panel.equalizeSplits"],
  ])("matches contributed action aliases for %s", (query, expectedId) => {
    expect(contributedActionIdsFor(query)[0]).toBe(expectedId);
  });

  it("uses frecency only as a tie breaker within the same text relevance tier", () => {
    const docs: SearchDocument<Action>[] = [
      buildActionSearchDocument(action("pier.panel.lowUse", "Balance Panels")),
      buildActionSearchDocument(action("pier.panel.highUse", "Balance Layout")),
    ];

    expect(
      rankActionSearchDocuments(docs, "balance", {
        frecencyMap: new Map([
          ["pier.panel.lowUse", 1],
          ["pier.panel.highUse", 50],
        ]),
      }).map((result) => result.document.id)
    ).toEqual(["pier.panel.highUse", "pier.panel.lowUse"]);
  });
});
