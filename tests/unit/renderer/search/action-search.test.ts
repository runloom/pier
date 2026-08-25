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
} from "@/lib/search/action.ts";
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

/** 命令面板 git 主路径命令（不含 review 树 surface-only 动作）。 */
const LOOMDESK_GIT_ACTION_IDS = [
  "pier.git.viewChanges",
  "pier.git.pull",
  "pier.git.push",
  "pier.git.sync",
  "pier.git.switchBranch",
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
  "pier.git.cherryPick",
  "pier.git.cherryPickAbort",
  "pier.git.cherryPickContinue",
  "pier.git.revert",
  "pier.git.revertAbort",
  "pier.git.revertContinue",
  "pier.git.undoLastCommit",
] as const;

const WORKTREE_ACTION_IDS = [
  "pier.worktree.create",
  "pier.worktree.delete",
  "pier.worktree.prune",
  "pier.worktree.list",
] as const;

/**
 * 主操作 + 变体（abort/continue/apply…）共享 `git <verb>` compact 前缀。
 * progressiveFrom 为 en 主 alias 去分隔符后的串；前缀从长度 4 起（跳过裸 `git`，
 * 那是类目级查询，不是 verb 缩写）。
 */
const GIT_VERB_FAMILIES = [
  {
    family: "merge",
    primary: "pier.git.merge",
    variants: ["pier.git.mergeAbort"],
    progressiveFrom: "gitmerge",
    /** 用户常用缩写：主操作还应是全表第一 */
    headQueries: ["gm", "gitm", "gitme"],
  },
  {
    family: "stash",
    primary: "pier.git.stash",
    variants: [
      "pier.git.stashApply",
      "pier.git.stashDrop",
      "pier.git.stashIncludeUntracked",
      "pier.git.stashPop",
    ],
    progressiveFrom: "gitstash",
    headQueries: [] as string[],
  },
  {
    family: "rebase",
    primary: "pier.git.rebase",
    variants: ["pier.git.rebaseAbort", "pier.git.rebaseContinue"],
    progressiveFrom: "gitrebase",
    headQueries: [] as string[],
  },
  {
    family: "cherryPick",
    primary: "pier.git.cherryPick",
    variants: ["pier.git.cherryPickAbort", "pier.git.cherryPickContinue"],
    progressiveFrom: "gitcherrypick",
    headQueries: [] as string[],
  },
  {
    family: "revert",
    primary: "pier.git.revert",
    variants: ["pier.git.revertAbort", "pier.git.revertContinue"],
    progressiveFrom: "gitrevert",
    headQueries: [] as string[],
  },
] as const;

function progressiveCompactQueries(compact: string, minLen = 4): string[] {
  const queries: string[] = [];
  for (let len = minLen; len <= compact.length; len += 1) {
    queries.push(compact.slice(0, len));
  }
  return queries;
}

function expectPrimaryBeforeVariants(
  ranked: readonly string[],
  primary: string,
  variants: readonly string[]
): void {
  const primaryIndex = ranked.indexOf(primary);
  expect(
    primaryIndex,
    `expected primary ${primary} to be recalled`
  ).toBeGreaterThanOrEqual(0);
  for (const variant of variants) {
    const variantIndex = ranked.indexOf(variant);
    if (variantIndex < 0) {
      continue;
    }
    expect(
      primaryIndex,
      `expected ${primary} before ${variant} (got primary@${primaryIndex}, variant@${variantIndex})`
    ).toBeLessThan(variantIndex);
  }
}

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
        { categoryLabel: "git" }
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
  ])("matches git merge action like loomdesk: %s", (query) => {
    const docs = [
      buildActionSearchDocument(
        action("pier.git.merge", "git: Merge Branch...", [
          "git merge",
          "merge branch",
          "合并",
          "分支",
        ]),
        { categoryLabel: "git" }
      ),
      buildActionSearchDocument(action("pier.git.stash", "git: Stash"), {
        categoryLabel: "git",
      }),
    ];

    expect(rankActionSearchDocuments(docs, query)[0]?.document.id).toBe(
      "pier.git.merge"
    );
  });

  // compact 缩写会同时命中主 alias（git merge）与变体（git merge abort）。
  // 平局必须用「命中字段长度」，不能用展示标题长度（中止类标题更短会误抢位）。
  const gitVerbFamilyCases = GIT_VERB_FAMILIES.flatMap((family) => {
    const progressive = progressiveCompactQueries(family.progressiveFrom);
    const queries = [...new Set([...progressive, ...family.headQueries])];
    return (["en", "zh-CN"] as const).flatMap((titleLocale) =>
      queries.map((query) => ({
        expectHead: (family.headQueries as readonly string[]).includes(query),
        family: family.family,
        primary: family.primary,
        query,
        titleLocale,
        variants: family.variants,
      }))
    );
  });

  it.each(
    gitVerbFamilyCases
  )("ranks $family primary before variants for $titleLocale / $query", ({
    expectHead,
    primary,
    query,
    titleLocale,
    variants,
  }) => {
    const docs = titleLocale === "zh-CN" ? gitCommandDocsZh : gitCommandDocs;
    const ranked = rankActionSearchDocuments(docs, query).map(
      (result) => result.document.id
    );
    expectPrimaryBeforeVariants(ranked, primary, variants);
    if (expectHead) {
      expect(ranked[0]).toBe(primary);
    }
  });

  it("prefers shorter matched alias over shorter display title at same tier", () => {
    const docs = [
      buildActionSearchDocument(
        action("pier.git.mergeAbort", "git: 中止合并", [
          "中止合并",
          "git merge abort",
        ]),
        { categoryLabel: "git" }
      ),
      buildActionSearchDocument(
        action("pier.git.merge", "git: 合并分支...", ["合并分支", "git merge"]),
        { categoryLabel: "git" }
      ),
    ];

    expect(
      rankActionSearchDocuments(docs, "gitm").map(
        (result) => result.document.id
      )
    ).toEqual(["pier.git.merge", "pier.git.mergeAbort"]);
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
    // 切换分支：CLI 习惯与无空格缩写
    ["git checkout", "pier.git.switchBranch"],
    ["gitcheck", "pier.git.switchBranch"],
    ["gitcheckout", "pier.git.switchBranch"],
    ["gco", "pier.git.switchBranch"],
    ["检出", "pier.git.switchBranch"],
    ["检出分支", "pier.git.switchBranch"],
    ["新建分支", "pier.git.switchBranch"],
    ["create branch", "pier.git.switchBranch"],
    // 远端同步 / 变更面板（能力终态）
    ["git pull", "pier.git.pull"],
    ["pull", "pier.git.pull"],
    ["拉取", "pier.git.pull"],
    ["git push", "pier.git.push"],
    ["推送", "pier.git.push"],
    ["sync", "pier.git.sync"],
    ["同步", "pier.git.sync"],
    ["git status", "pier.git.viewChanges"],
    ["查看变更", "pier.git.viewChanges"],
    ["diff", "pier.git.viewChanges"],
    // undo / stash 同义
    ["soft reset", "pier.git.undoLastCommit"],
    ["uncommit", "pier.git.undoLastCommit"],
    ["撤销提交", "pier.git.undoLastCommit"],
    ["贮藏", "pier.git.stash"],
    ["git stash -u", "pier.git.stashIncludeUntracked"],
  ])("matches every LoomDesk git command keyword: %s", (query, expectedId) => {
    expect(
      rankActionSearchDocuments(gitCommandDocs, query)[0]?.document.id
    ).toBe(expectedId);
  });

  it("uses the production git-prefixed titles for every git command document", () => {
    for (const docs of [gitCommandDocs, gitCommandDocsZh]) {
      expect(docs).toHaveLength(LOOMDESK_GIT_ACTION_IDS.length);
      for (const doc of docs) {
        expect(doc.title.startsWith("git: ")).toBe(true);
      }
    }
  });

  it.each([
    "git",
    "git:",
  ])("recalls every git command for the shared prefix query: %s", (query) => {
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
    ["en", "git: Stash", ["pier.git.stash"]],
    ["en", "git stash pop", ["pier.git.stashPop"]],
    ["en", "git: undo", ["pier.git.undoLastCommit"]],
    ["zh-CN", "git: 合并", ["pier.git.merge"]],
    ["zh-CN", "git 合并", ["pier.git.merge"]],
    [
      "zh-CN",
      "git: 储藏",
      ["pier.git.stash", "pier.git.stashIncludeUntracked"],
    ],
    ["zh-CN", "git: 变基", ["pier.git.rebase"]],
    ["zh-CN", "git: 撤销", ["pier.git.undoLastCommit"]],
  ])("matches prefixed git queries against %s titles: %s", (titleLocale, query, expectedIds) => {
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
    ["zh-CN", "储藏", ["pier.git.stash", "pier.git.stashIncludeUntracked"]],
  ])("keeps matching bare operation keywords with %s prefixed titles: %s", (titleLocale, query, expectedIds) => {
    const docs = titleLocale === "zh-CN" ? gitCommandDocsZh : gitCommandDocs;
    expect(expectedIds).toContain(
      rankActionSearchDocuments(docs, query)[0]?.document.id
    );
  });

  it("ranks a prefixed-title match above a frecency-boosted alias match", () => {
    const docs = [
      buildActionSearchDocument(
        action("pier.git.stash", "git: Stash", ["git stash", "stash save"]),
        { categoryLabel: "git" }
      ),
      buildActionSearchDocument(
        action("pier.git.stashPop", "git: Pop Stash...", [
          "git stash pop",
          "pop stash",
          "restore stash",
        ]),
        { categoryLabel: "git" }
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
    "git",
  ])("ranks git-prefixed commands above frecency-boosted worktree category matches: %s", (query) => {
    const commandIds = ["pier.git.merge", "pier.git.stash"];
    const worktreeIds = ["pier.git.worktreeCreate", "pier.git.worktreeList"];
    const docs = [
      buildActionSearchDocument(
        action("pier.git.worktreeCreate", "创建工作树", ["worktree add"]),
        { categoryLabel: "git" }
      ),
      buildActionSearchDocument(
        action("pier.git.worktreeList", "工作树列表", ["worktree list"]),
        { categoryLabel: "git" }
      ),
      buildActionSearchDocument(
        action("pier.git.merge", "git: Merge Branch...", ["git merge"]),
        { categoryLabel: "git" }
      ),
      buildActionSearchDocument(action("pier.git.stash", "git: Stash"), {
        categoryLabel: "git",
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

  it("prefers earlier same-tier title matches over later ones with higher frecency", () => {
    const docs = [
      buildActionSearchDocument(action("pier.late", "Advanced Theme Panel")),
      buildActionSearchDocument(action("pier.early", "My Theme Editor")),
    ];

    expect(
      rankActionSearchDocuments(docs, "theme", {
        frecencyMap: new Map([
          ["pier.late", 100],
          ["pier.early", 1],
        ]),
      }).map((result) => result.document.id)
    ).toEqual(["pier.early", "pier.late"]);
  });

  it("prefers tighter title matches before frecency within the same tier", () => {
    const docs = [
      buildActionSearchDocument(
        action("pier.long", "Theme Preferences and Colors")
      ),
      buildActionSearchDocument(action("pier.short", "Theme Prefs")),
    ];

    expect(
      rankActionSearchDocuments(docs, "theme", {
        frecencyMap: new Map([
          ["pier.long", 80],
          ["pier.short", 1],
        ]),
      }).map((result) => result.document.id)
    ).toEqual(["pier.short", "pier.long"]);
  });

  // Worktree 命令已整体退出 "git" 查询空间:别名并集不再含任何 "git" 词面,
  // 类目标签也从 "git" 改为 "Worktree"/"工作树"。同场放入真实 git 命令文档,
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
    "git",
    "git:",
  ])("keeps worktree commands out of git queries despite high frecency: %s", (query) => {
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

  it.each([
    ["wt list", "pier.worktree.list"],
    ["打开工作树", "pier.worktree.list"],
    ["切换工作树", "pier.worktree.list"],
    ["open worktree", "pier.worktree.list"],
  ])("matches worktree list shortcuts without entering git namespace: %s", (query, expectedId) => {
    for (const [worktreeDocs, gitDocs] of worktreeScenes()) {
      const ranked = rankActionSearchDocuments(
        [...worktreeDocs, ...gitDocs],
        query
      );
      expect(ranked[0]?.document.id).toBe(expectedId);
      expect(
        ranked.every((result) => !result.document.id.startsWith("pier.git."))
      ).toBe(true);
    }
  });

  it("matches bare wt to worktree family only", () => {
    for (const [worktreeDocs, gitDocs] of worktreeScenes()) {
      const ranked = rankActionSearchDocuments(
        [...worktreeDocs, ...gitDocs],
        "wt"
      );
      expect(ranked.length).toBeGreaterThan(0);
      expect(
        ranked.every((result) =>
          result.document.id.startsWith("pier.worktree.")
        )
      ).toBe(true);
    }
  });
});
