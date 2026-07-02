import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ALL_ACTION_CONTRIBUTIONS } from "@/lib/actions/all-action-contributions.ts";
import { createActionFromContribution } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContributionRuntime } from "@/lib/actions/contribution-types.ts";
import { resolveActionAliases } from "@/lib/actions/renderer-action-runtime.ts";
import type { Action } from "@/lib/actions/types.ts";
import {
  buildActionSearchDocument,
  rankActionSearchDocuments,
} from "@/lib/search/action-search.ts";
import type { SearchDocument } from "@/lib/search/types.ts";

interface GitLocaleCommand {
  aliases?: string[];
  title?: string;
}

interface GitLocaleMessages {
  commands?: Record<string, GitLocaleCommand>;
}

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
  resolveAliases: resolveActionAliases,
  t: (key) => i18next.t(key),
};

const LOOMDESK_GIT_ACTION_IDS = [
  "pier.git.merge",
  "pier.git.mergeAbort",
  "pier.git.stash",
  "pier.git.stashPop",
  "pier.git.rebase",
  "pier.git.rebaseAbort",
  "pier.git.rebaseContinue",
  "pier.git.undoLastCommit",
] as const;

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

async function readGitLocale(
  locale: "en" | "zh-CN"
): Promise<GitLocaleMessages> {
  const raw = await readFile(
    join(process.cwd(), "src/plugins/builtin/git/locales", `${locale}.json`),
    "utf8"
  );
  return JSON.parse(raw) as GitLocaleMessages;
}

async function buildGitCommandSearchDocuments(): Promise<
  SearchDocument<Action>[]
> {
  const [en, zhCN] = await Promise.all([
    readGitLocale("en"),
    readGitLocale("zh-CN"),
  ]);
  const locales = [en, zhCN];
  const ids = new Set<string>(LOOMDESK_GIT_ACTION_IDS);

  return GIT_PLUGIN_MANIFEST.commands
    .filter((command) => ids.has(command.id))
    .map((command) =>
      buildActionSearchDocument(
        action(
          command.id,
          en.commands?.[command.id]?.title ?? command.title,
          locales.flatMap(
            (locale) => locale.commands?.[command.id]?.aliases ?? []
          )
        ),
        { categoryLabel: "Git" }
      )
    );
}

describe("action search", () => {
  let gitCommandDocs: SearchDocument<Action>[] = [];

  beforeAll(async () => {
    await initI18n();
    gitCommandDocs = await buildGitCommandSearchDocuments();
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

  it("uses contribution order as the final tie-breaker like LoomDesk", () => {
    const docs: SearchDocument<Action>[] = [
      buildActionSearchDocument(action("pier.panel.zebra", "Balance")),
      buildActionSearchDocument(action("pier.panel.alpha", "Balance")),
    ];

    expect(
      rankActionSearchDocuments(docs, "balance").map(
        (result) => result.document.id
      )
    ).toEqual(["pier.panel.zebra", "pier.panel.alpha"]);
  });

  it.each([
    "merge",
    "git:merge",
    "git merge",
    "gitm",
    "gm",
    "合并",
    "分支",
  ])("matches Git merge action like loomdesk: %s", (query) => {
    const docs = [
      buildActionSearchDocument(
        action("pier.git.merge", "Merge Branch...", [
          "git merge",
          "merge branch",
          "合并",
          "分支",
        ]),
        { categoryLabel: "Git" }
      ),
      buildActionSearchDocument(action("pier.git.stash", "Stash"), {
        categoryLabel: "Git",
      }),
    ];

    expect(rankActionSearchDocuments(docs, query)[0]?.document.id).toBe(
      "pier.git.merge"
    );
  });

  it.each([
    ["git merge", "pier.git.merge"],
    ["合并分支", "pier.git.merge"],
    ["git merge abort", "pier.git.mergeAbort"],
    ["中止合并", "pier.git.mergeAbort"],
    ["git stash", "pier.git.stash"],
    ["暂存更改", "pier.git.stash"],
    ["git stash apply", "pier.git.stashPop"],
    ["恢复", "pier.git.stashPop"],
    ["git rebase", "pier.git.rebase"],
    ["变基到分支", "pier.git.rebase"],
    ["git rebase abort", "pier.git.rebaseAbort"],
    ["中止变基", "pier.git.rebaseAbort"],
    ["git rebase continue", "pier.git.rebaseContinue"],
    ["继续变基", "pier.git.rebaseContinue"],
    ["git reset", "pier.git.undoLastCommit"],
    ["回退", "pier.git.undoLastCommit"],
  ])("matches every LoomDesk Git command keyword: %s", (query, expectedId) => {
    expect(
      rankActionSearchDocuments(gitCommandDocs, query)[0]?.document.id
    ).toBe(expectedId);
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
