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
      activeIsTaskPanel: false,
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
  "pier.git.stashApply",
  "pier.git.stashDrop",
  "pier.git.stashIncludeUntracked",
  "pier.git.stashPop",
  "pier.git.rebase",
  "pier.git.rebaseAbort",
  "pier.git.rebaseContinue",
  "pier.git.undoLastCommit",
] as const;

const WORKTREE_ACTION_IDS = [
  "pier.worktree.create",
  "pier.worktree.delete",
  "pier.worktree.prune",
  "pier.worktree.list",
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

async function buildGitCommandSearchDocuments(
  titleLocale: "en" | "zh-CN" = "en"
): Promise<SearchDocument<Action>[]> {
  const [en, zhCN] = await Promise.all([
    readGitLocale("en"),
    readGitLocale("zh-CN"),
  ]);
  const locales = [en, zhCN];
  const titleSource = titleLocale === "zh-CN" ? zhCN : en;
  const ids = new Set<string>(LOOMDESK_GIT_ACTION_IDS);

  return GIT_PLUGIN_MANIFEST.commands
    .filter((command) => ids.has(command.id))
    .map((command) =>
      buildActionSearchDocument(
        action(
          command.id,
          titleSource.commands?.[command.id]?.title ?? command.title,
          locales.flatMap(
            (locale) => locale.commands?.[command.id]?.aliases ?? []
          )
        ),
        { categoryLabel: "Git" }
      )
    );
}

// 产线态 worktree 文档:标题/类目标签跟随当前语言,别名取 en/zh locale 并集
// (插件别名是跨 locale 聚合的,zh 会话同样背着 en 别名)。
async function buildWorktreeCommandSearchDocuments(
  titleLocale: "en" | "zh-CN" = "en"
): Promise<SearchDocument<Action>[]> {
  const [en, zhCN] = await Promise.all([
    readGitLocale("en"),
    readGitLocale("zh-CN"),
  ]);
  const locales = [en, zhCN];
  const titleSource = titleLocale === "zh-CN" ? zhCN : en;
  const ids = new Set<string>(WORKTREE_ACTION_IDS);
  const categoryLabel = titleLocale === "zh-CN" ? "工作树" : "Worktree";

  return GIT_PLUGIN_MANIFEST.commands
    .filter((command) => ids.has(command.id))
    .map((command) =>
      buildActionSearchDocument(
        action(
          command.id,
          titleSource.commands?.[command.id]?.title ?? command.title,
          locales.flatMap(
            (locale) => locale.commands?.[command.id]?.aliases ?? []
          )
        ),
        { categoryLabel }
      )
    );
}

describe("action search", () => {
  let gitCommandDocs: SearchDocument<Action>[] = [];
  let gitCommandDocsZh: SearchDocument<Action>[] = [];

  beforeAll(async () => {
    await initI18n();
    gitCommandDocs = await buildGitCommandSearchDocuments();
    gitCommandDocsZh = await buildGitCommandSearchDocuments("zh-CN");
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
        action("pier.git.merge", "Git: Merge Branch...", [
          "git merge",
          "merge branch",
          "合并",
          "分支",
        ]),
        { categoryLabel: "Git" }
      ),
      buildActionSearchDocument(action("pier.git.stash", "Git: Stash"), {
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
    ["git stash apply", "pier.git.stashApply"],
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

  it("uses the production Git-prefixed titles for every Git command document", () => {
    for (const docs of [gitCommandDocs, gitCommandDocsZh]) {
      expect(docs).toHaveLength(LOOMDESK_GIT_ACTION_IDS.length);
      for (const doc of docs) {
        expect(doc.title.startsWith("Git: ")).toBe(true);
      }
    }
  });

  it.each([
    "git",
    "Git:",
  ])("recalls every Git command for the shared prefix query: %s", (query) => {
    for (const docs of [gitCommandDocs, gitCommandDocsZh]) {
      const ids = rankActionSearchDocuments(docs, query).map(
        (result) => result.document.id
      );
      expect(new Set(ids)).toEqual(new Set(LOOMDESK_GIT_ACTION_IDS));
    }
  });

  // 期望值为「可接受集合」：stash 家族扩充后，部分查询在 stash 与
  // Stash (Include Untracked) 之间同 tier 同 matchIndex，头名由 fuzzyOrder
  // 决定，属合法平局——断言收敛到家族内即可，不赌 fuzzy 排序。
  it.each([
    ["en", "git: merge", ["pier.git.merge"]],
    ["en", "git merge branch", ["pier.git.merge"]],
    ["en", "Git: Stash", ["pier.git.stash"]],
    ["en", "git stash pop", ["pier.git.stashPop"]],
    ["en", "git: undo", ["pier.git.undoLastCommit"]],
    ["zh-CN", "Git: 合并", ["pier.git.merge"]],
    ["zh-CN", "git 合并", ["pier.git.merge"]],
    [
      "zh-CN",
      "Git: 暂存",
      ["pier.git.stash", "pier.git.stashIncludeUntracked"],
    ],
    ["zh-CN", "Git: 变基", ["pier.git.rebase"]],
    ["zh-CN", "git: 撤销", ["pier.git.undoLastCommit"]],
  ])("matches prefixed Git queries against %s titles: %s", (titleLocale, query, expectedIds) => {
    const docs = titleLocale === "zh-CN" ? gitCommandDocsZh : gitCommandDocs;
    expect(expectedIds).toContain(
      rankActionSearchDocuments(docs, query)[0]?.document.id
    );
  });

  it.each([
    ["en", "merge", ["pier.git.merge"]],
    ["en", "stash", ["pier.git.stash", "pier.git.stashIncludeUntracked"]],
    ["en", "rebase", ["pier.git.rebase"]],
    ["zh-CN", "合并", ["pier.git.merge"]],
    ["zh-CN", "合并分支", ["pier.git.merge"]],
    ["zh-CN", "暂存", ["pier.git.stash", "pier.git.stashIncludeUntracked"]],
  ])("keeps matching bare operation keywords with %s prefixed titles: %s", (titleLocale, query, expectedIds) => {
    const docs = titleLocale === "zh-CN" ? gitCommandDocsZh : gitCommandDocs;
    expect(expectedIds).toContain(
      rankActionSearchDocuments(docs, query)[0]?.document.id
    );
  });

  it("ranks a prefixed-title match above a frecency-boosted alias match", () => {
    const docs = [
      buildActionSearchDocument(
        action("pier.git.stash", "Git: Stash", ["git stash", "stash save"]),
        { categoryLabel: "Git" }
      ),
      buildActionSearchDocument(
        action("pier.git.stashPop", "Git: Pop Stash...", [
          "git stash pop",
          "pop stash",
          "restore stash",
        ]),
        { categoryLabel: "Git" }
      ),
    ];

    expect(
      rankActionSearchDocuments(docs, "git: stash", {
        frecencyMap: new Map([["pier.git.stashPop", 50]]),
      })[0]?.document.id
    ).toBe("pier.git.stash");
  });

  it.each([
    "git",
    "Git",
  ])("ranks Git-prefixed commands above frecency-boosted worktree category matches: %s", (query) => {
    const commandIds = ["pier.git.merge", "pier.git.stash"];
    const worktreeIds = ["pier.git.worktreeCreate", "pier.git.worktreeList"];
    const docs = [
      buildActionSearchDocument(
        action("pier.git.worktreeCreate", "创建工作树", ["worktree add"]),
        { categoryLabel: "Git" }
      ),
      buildActionSearchDocument(
        action("pier.git.worktreeList", "工作树列表", ["worktree list"]),
        { categoryLabel: "Git" }
      ),
      buildActionSearchDocument(
        action("pier.git.merge", "Git: Merge Branch...", ["git merge"]),
        { categoryLabel: "Git" }
      ),
      buildActionSearchDocument(action("pier.git.stash", "Git: Stash"), {
        categoryLabel: "Git",
      }),
    ];

    const ids = rankActionSearchDocuments(docs, query, {
      frecencyMap: new Map([
        ["pier.git.worktreeCreate", 60],
        ["pier.git.worktreeList", 80],
      ]),
    }).map((result) => result.document.id);

    expect(new Set(ids)).toEqual(new Set([...commandIds, ...worktreeIds]));
    expect(new Set(ids.slice(0, commandIds.length))).toEqual(
      new Set(commandIds)
    );
    expect(ids.indexOf("pier.git.worktreeList")).toBeLessThan(
      ids.indexOf("pier.git.worktreeCreate")
    );
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

  // Worktree 命令已整体退出 "git" 查询空间:别名并集不再含任何 "git" 词面,
  // 类目标签也从 "Git" 改为 "Worktree"/"工作树"。同场放入真实 Git 命令文档,
  // 证明 "git" 查询本身仍有召回,worktree 零命中不是空集空转。
  let worktreeCommandDocs: SearchDocument<Action>[] = [];
  let worktreeCommandDocsZh: SearchDocument<Action>[] = [];

  beforeAll(async () => {
    worktreeCommandDocs = await buildWorktreeCommandSearchDocuments();
    worktreeCommandDocsZh = await buildWorktreeCommandSearchDocuments("zh-CN");
  });

  const worktreeScenes = (): ReadonlyArray<
    readonly [SearchDocument<Action>[], SearchDocument<Action>[]]
  > => [
    [worktreeCommandDocs, gitCommandDocs],
    [worktreeCommandDocsZh, gitCommandDocsZh],
  ];

  it.each([
    "git",
    "Git",
    "git:",
  ])("keeps worktree commands out of Git queries despite high frecency: %s", (query) => {
    for (const [worktreeDocs, gitDocs] of worktreeScenes()) {
      const ids = rankActionSearchDocuments(
        [...worktreeDocs, ...gitDocs],
        query,
        {
          frecencyMap: new Map(
            WORKTREE_ACTION_IDS.map((id): [string, number] => [id, 200])
          ),
        }
      ).map((result) => result.document.id);

      expect(ids.filter((id) => id.startsWith("pier.worktree."))).toEqual([]);
      expect(new Set(ids)).toEqual(new Set(LOOMDESK_GIT_ACTION_IDS));
    }
  });

  it.each([
    "worktree",
    "工作树",
  ])("still recalls every worktree command through the cross-locale alias union: %s", (query) => {
    for (const [worktreeDocs, gitDocs] of worktreeScenes()) {
      const ids = rankActionSearchDocuments(
        [...worktreeDocs, ...gitDocs],
        query
      ).map((result) => result.document.id);

      for (const worktreeId of WORKTREE_ACTION_IDS) {
        expect(ids).toContain(worktreeId);
      }
    }
  });
});
