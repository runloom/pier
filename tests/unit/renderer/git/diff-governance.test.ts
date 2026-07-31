import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

async function localDependencySources(
  entries: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  const pending = entries.map((entry) => join(ROOT, entry));
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || sources.has(file)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    sources.set(file, source);
    for (const match of source.matchAll(
      /(?:from\s+|import\()\s*["']([^"']+)["']/gu
    )) {
      const specifier = match[1];
      if (specifier?.startsWith(".")) {
        pending.push(resolve(dirname(file), specifier));
      } else if (specifier === "@pier/ui/diff-view/index.tsx") {
        pending.push(join(ROOT, "packages/ui/src/diff-view/index.tsx"));
      }
    }
  }
  return sources;
}

describe("Git diff renderer governance", () => {
  it("只允许 packages/ui 的 diff-view 适配器模块导入 Pierre 运行时", async () => {
    const files = [
      ...(await sourceFiles(join(ROOT, "src"))),
      ...(await sourceFiles(join(ROOT, "packages/ui/src"))),
    ];
    const importers: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (source.includes('from "@pierre/diffs')) {
        importers.push(relative(ROOT, file));
      }
    }

    expect(importers).toEqual([
      "packages/ui/src/diff-view/hunk-annotations.ts",
      "packages/ui/src/diff-view/index.tsx",
      "packages/ui/src/diff-view/item-sync.ts",
      "packages/ui/src/diff-view/item-transition.ts",
      "packages/ui/src/diff-view/items.ts",
      "packages/ui/src/diff-view/pointer-selection.ts",
      "packages/ui/src/diff-view/selection-text.ts",
      "packages/ui/src/diff-view/topology-scroll.ts",
      "packages/ui/src/diff-view/use-code-options.ts",
      "packages/ui/src/diff-view/use-content-selection.ts",
      "packages/ui/src/diff-view/use-handle.ts",
      "packages/ui/src/diff-view/use-headers.tsx",
      "packages/ui/src/diff-view/use-item-apply.ts",
      "packages/ui/src/diff-view/worker.tsx",
    ]);
  });

  it("锁定官方正文边界、配置和根容器且不恢复自绘正文", async () => {
    const uiFiles = await sourceFiles(join(ROOT, "packages/ui/src"));
    const source = await readFile(
      join(ROOT, "packages/ui/src/diff-view/index.tsx"),
      "utf8"
    );
    const codeOptionsSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view/use-code-options.ts"),
      "utf8"
    );
    const appearanceSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view/appearance.ts"),
      "utf8"
    );
    const collapseSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view/collapse.tsx"),
      "utf8"
    );
    const workerSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view/worker.tsx"),
      "utf8"
    );
    const customCss = appearanceSource.match(
      /const CODE_VIEW_CUSTOM_CSS = `([\s\S]*?)`;/u
    )?.[1];
    const codeViewOptions = codeOptionsSource.match(
      /useMemo<CodeViewOptions<[^>]+>>\(\n\s+\(\) => \(\{([\s\S]*?)\n\s+\}\),\n\s+\[[\s\S]*?\n\s+\]\n\s+\);/u
    )?.[1];
    const adapterSource = `${source}\n${codeOptionsSource}`;

    expect(uiFiles.map((file) => relative(ROOT, file))).not.toContain(
      "packages/ui/src/diff-view/diff-view-profile.ts"
    );
    expect(workerSource).toContain("worker/worker.js");
    expect(adapterSource).toContain('preferredHighlighter: "shiki-wasm"');
    expect(codeOptionsSource).toContain(
      "PIER_DIFF_VIEW_TOKENIZE_MAX_LINES = 5000"
    );
    expect(codeViewOptions).toContain(
      "tokenizeMaxLength: PIER_DIFF_VIEW_TOKENIZE_MAX_LINES"
    );
    // diffStyle/overflow 由 PierDiffViewPresentation 驱动(split/unified、wrap),
    // 缺省仍是 split + scroll;其余配置保持锁定。
    // Codex hunk stage uses annotations + renderAnnotation, not gutter utility.
    // Keep enableGutterUtility false (no review comments → no empty "+").
    expect(codeViewOptions).toContain("enableGutterUtility: false");
    expect(codeViewOptions).not.toContain("onGutterUtilityClick:");
    expect(adapterSource).toContain("renderPierHunkAnnotation");
    expect(adapterSource).toContain("onHunkAction");
    // Codex Tn: -top-8.5 right-0.5 pill + per-file hover + icon-xs ghost.
    // Hover reveal is document-level (light DOM portals); shadow uses :host().
    expect(adapterSource).toContain("data-pier-file-host");
    expect(adapterSource).toContain("ensurePierDiffLightDomStyles");
    expect(appearanceSource).toContain(
      "diffs-container[data-pier-file-host]:hover [data-pier-hunk-actions]"
    );
    expect(appearanceSource).toContain(
      "diffs-container[data-pier-file-host][data-pier-pointer-within] [data-pier-hunk-actions]"
    );
    expect(codeOptionsSource).toContain(
      'element.addEventListener("pointerover", handlePointerOver)'
    );
    expect(codeOptionsSource).toContain(
      'element.removeEventListener("pointerleave", handlePointerLeave)'
    );
    expect(appearanceSource).toContain(
      ":host([data-pier-file-host]) [data-annotation-content]"
    );
    const annotationContentOverride = appearanceSource.match(
      /:host\(\[data-pier-file-host\]\) \[data-annotation-content\] \{([\s\S]*?)\n {2}\}/u
    )?.[1];
    expect(annotationContentOverride).toBeDefined();
    expect(annotationContentOverride).not.toMatch(
      /\b(?:left|position|width)\s*:/u
    );
    const hunkActions = await readFile(
      join(ROOT, "packages/ui/src/diff-view/hunk-actions.tsx"),
      "utf8"
    );
    expect(hunkActions).toContain("-top-8.5");
    expect(hunkActions).toContain("right-0.5");
    expect(hunkActions).toContain('size="icon-xs"');
    expect(hunkActions).toContain('variant="ghost"');
    expect(hunkActions).toContain("primaryHunkActionForVariant");
    expect(hunkActions).not.toContain("<Tooltip>");
    expect(hunkActions).toContain("title={label}");
    expect(codeViewOptions).toContain('diffIndicators: "bars"');
    expect(codeViewOptions).toContain("enableLineSelection: true");
    expect(codeViewOptions).toContain('preferredHighlighter: "shiki-wasm"');
    expect(codeViewOptions).toContain("stickyHeaders: true");
    expect(codeViewOptions).toContain("unsafeCSS: CODE_VIEW_CUSTOM_CSS");

    expect(source).toContain(
      'const diffStyle = presentation?.diffStyle ?? "split";'
    );
    expect(source).toContain(
      'const overflow = presentation?.wrapLines === true ? "wrap" : "scroll";'
    );
    expect(adapterSource.match(/unsafeCSS:/gu)).toHaveLength(1);
    expect(appearanceSource).toContain("SCROLLBAR_SYSTEM_CSS");
    expect(appearanceSource).toContain('from "../scrollbar-system.ts"');
    expect(customCss).toBeDefined();
    expect(/\$\{SCROLLBAR_SYSTEM_CSS\}/.test(customCss ?? "")).toBe(true);
    expect(appearanceSource).toContain("DIFF_HEADER_HEIGHT_PX = 32");
    expect(appearanceSource).toContain("min-height: 32px");
    expect(adapterSource).toContain('from "./sticky-stabilize.ts"');
    // 挂载 layout 会 reapply；onPostRender 热路径 reapply:false 只 patch
    expect(adapterSource).toContain("stabilizeCodeViewStickyPositioning(");
    expect(adapterSource).toContain("reapply: false");
    expect(customCss).toContain("[data-diffs-header]");
    expect(customCss).toContain("[data-metadata] > [data-deletions-count]");
    expect(source).toContain("renderHeaderMetadata={renderHeaderMetadata}");
    const codeViewClassName = source.match(
      /<CodeView\s+className="([^"]+)"/u
    )?.[1];
    expect(source).toContain('data-scrollbar="overlay"');
    expect(codeViewClassName).toContain("cv-scrollbar");
    expect(codeViewClassName).toContain("[scrollbar-gutter:auto]");
    const packageJson = JSON.parse(
      await readFile(join(ROOT, "packages/ui/package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    const lockfile = await readFile(join(ROOT, "pnpm-lock.yaml"), "utf8");
    expect(packageJson.dependencies?.["@pierre/diffs"]).toBe("1.2.12");
    expect(lockfile).toContain(
      "sha512-pY/gmgWL03WnagqCyCnBi3QtRXUv4hCIY6FYqd5b1ZGaoI6a4Bsji8j+yRl2RfzPh/8Hf19rCl1GE80G6a1cLQ=="
    );
    expect(`${adapterSource}\n${appearanceSource}`).not.toMatch(
      /#[0-9a-f]{3,8}|rgb\(|hsl\(|oklch\(/iu
    );
    expect(source).toContain("renderHeaderPrefix={renderHeaderPrefix}");
    expect(collapseSource).toContain("function CollapseDiffButton(");
    expect(collapseSource).toContain("shouldRotateCollapseChevron");
    expect(collapseSource).toContain("loading");
    expect(collapseSource).not.toContain(
      '(disabled || collapsed) && "-rotate-90"'
    );
    expect(collapseSource).toContain("function IconChevronSm(");
    expect(collapseSource).toContain(
      'd="M.47 5.47a.75.75 0 0 1 1.06 0L5 8.94l3.47-3.47a.75.75 0 0 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06"'
    );
    expect(collapseSource).toContain(
      '"text-muted-foreground hover:bg-muted hover:text-foreground ml-[-8px] inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-50"'
    );
    expect(collapseSource).not.toContain("lucide-react");
    expect(source).not.toMatch(
      /render(?:CustomHeader|Hunk|Line)|FileDiff|PatchDiff/u
    );
    expect(workerSource).toContain("function isMobileBrowser(): boolean");
    expect(workerSource).toContain(
      "? { poolSize: 1, totalASTLRUCacheSize: 10 }"
    );
    expect(workerSource).toContain(
      ": { poolSize: 3, totalASTLRUCacheSize: 100 }"
    );
    expect(workerSource).toContain(
      'worker.addEventListener("error", reportWorkerPoolFailure);'
    );
    expect(source).toContain("disableWorkerPool={workerUnavailable}");
  });

  it("命令式正文更新只允许存在于 packages/ui 适配器，并禁止第二套 worker 池或 Shadow DOM 读取", async () => {
    const reviewSources = await localDependencySources([
      "packages/ui/src/diff-view/index.tsx",
      "src/plugins/builtin/git/renderer/changes-panel.tsx",
    ]);
    const violations: string[] = [];
    for (const [file, source] of reviewSources) {
      const isAdapter = [
        join(ROOT, "packages/ui/src/diff-view/index.tsx"),
        join(ROOT, "packages/ui/src/diff-view/item-sync.ts"),
        join(ROOT, "packages/ui/src/diff-view/item-transition.ts"),
        join(ROOT, "packages/ui/src/diff-view/use-handle.ts"),
        join(ROOT, "packages/ui/src/diff-view/use-headers.tsx"),
        join(ROOT, "packages/ui/src/diff-view/use-item-apply.ts"),
        join(ROOT, "packages/ui/src/diff-view/use-code-options.ts"),
        // estimate 骨架注入 shadowRoot（金标准 pending UI）
        join(ROOT, "packages/ui/src/diff-view/estimate-skeleton.ts"),
      ].includes(file);
      if (
        // 成员同步 API 仅适配层可用（\.setItems 避免误伤 React useState setItems）。
        (!isAdapter &&
          /\b(?:addItems|updateItemId|WorkerPoolManager)\b|\.setItems\b/u.test(
            source
          )) ||
        (!isAdapter && /\bupdateItem\b/u.test(source)) ||
        (!isAdapter && source.includes("shadowRoot"))
      ) {
        violations.push(relative(ROOT, file));
      }
    }

    expect(violations).toEqual([]);
    const adapter = [
      reviewSources.get(join(ROOT, "packages/ui/src/diff-view/index.tsx")),
      reviewSources.get(join(ROOT, "packages/ui/src/diff-view/item-sync.ts")),
      reviewSources.get(join(ROOT, "packages/ui/src/diff-view/use-handle.ts")),
      reviewSources.get(
        join(ROOT, "packages/ui/src/diff-view/use-headers.tsx")
      ),
      reviewSources.get(
        join(ROOT, "packages/ui/src/diff-view/use-item-apply.ts")
      ),
    ].join("\n");
    expect(adapter).toContain("getInstance()");
    expect(adapter).toContain("getRenderedItems()");
    expect(adapter).toContain("initialItems={codeViewItems}");
    expect(adapter).toContain("handle.updateItem(item)");
    // DiffsHub 对齐：成员变更走实例 API，禁止 id 列表 topology remount / 受控 items=。
    expect(adapter).toContain("syncCodeViewItems");
    expect(adapter).toContain("addItems");
    expect(adapter).toContain("setItems");
    expect(adapter).toContain("updateItemId");
    expect(adapter).toContain("planPathAlignedIdRenames");
    expect(adapter).toContain("suppressMembershipScrollRestore");
    expect(adapter).toContain("getSuppressMembershipScrollRestore");
    expect(adapter).toContain("shouldRestoreMembershipScrollTop");
    // 宿主 wiring：pending 同步闸门接到 DiffView（state + hasPendingNavigation ref）
    const surfaceView = await readFile(
      join(ROOT, "src/plugins/builtin/git/renderer/review/surface-view.tsx"),
      "utf8"
    );
    expect(surfaceView).toContain(
      "getSuppressMembershipScrollRestore={hasPendingNavigation}"
    );
    expect(surfaceView).toContain(
      "suppressMembershipScrollRestore={navigationPending}"
    );
    expect(adapter).not.toMatch(/JSON\.stringify\(\s*codeViewItems\.map/u);
    expect(adapter).not.toContain("items={codeViewItems}");
    expect(adapter).not.toMatch(/querySelector|shadowRoot/u);
    const changesSources = await localDependencySources([
      "src/plugins/builtin/git/renderer/changes-panel.tsx",
    ]);
    expect([...changesSources.values()].join("\n")).not.toMatch(
      /role=["']tree(?:item)?["']|<(?:li|ul)\b|@tanstack\/react-virtual/iu
    );
  });

  it("冻结五个 Review 命令并要求 Changes 继续复用 PierFileTree", async () => {
    const operations = await readFile(
      join(ROOT, "src/shared/contracts/git-review/operations.ts"),
      "utf8"
    );
    const commandTypes = [
      ...operations.matchAll(/z\.literal\("(git\.[^"]*Review[^"]*)"\)/gu),
    ].map((match) => match[1]);
    expect(commandTypes).toEqual([
      "git.getReviewIndex",
      "git.getReviewFileDocument",
      "git.cancelReviewRequest",
      "git.applyReviewMutation",
      "git.applyReviewPathMutation",
    ]);

    const reviewContent = await readFile(
      join(ROOT, "src/plugins/builtin/git/renderer/review/content.tsx"),
      "utf8"
    );
    const reviewDocumentView = await readFile(
      join(ROOT, "src/plugins/builtin/git/renderer/review/document/view.tsx"),
      "utf8"
    );
    const projectionCommit = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/hooks/use-projection-commit.ts"
      ),
      "utf8"
    );
    const itemReplay = await readFile(
      join(ROOT, "src/plugins/builtin/git/renderer/hooks/use-item-replay.ts"),
      "utf8"
    );
    const documentSession = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/hooks/use-document-session.ts"
      ),
      "utf8"
    );
    const documentGenerationEffect = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts"
      ),
      "utf8"
    );
    const documentSessionSync = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/review/document/session-sync.ts"
      ),
      "utf8"
    );
    const documentSessionRuntime = `${documentSession}\n${documentGenerationEffect}\n${documentSessionSync}`;
    const reviewRuntime = `${reviewContent}\n${projectionCommit}\n${itemReplay}\n${documentSessionRuntime}`;
    const reviewPanelLayout = await readFile(
      join(ROOT, "src/plugins/builtin/git/renderer/review/panel-layout.tsx"),
      "utf8"
    );
    expect(reviewPanelLayout).toContain(
      'import { PierFileTree } from "@pier/ui/file/tree.tsx";'
    );
    expect(reviewPanelLayout.match(/<PierFileTree\b/gu)).toHaveLength(1);
    expect(reviewDocumentView).toContain("<GitReviewPanelLayout");
    expect(projectionCommit).toContain(
      "renderedGenerationRef.current = projectionGeneration;"
    );
    // 全量 index section 映射（含未 materialize），供 demand / failure / 树导航解析。
    expect(projectionCommit).toContain(
      "entryKeyBySectionIdRef.current = fullSectionIndex;"
    );
    expect(projectionCommit).toContain(
      "indexReviewSectionEntries(entries, diffBase)"
    );
    expect(projectionCommit).toContain("itemCacheKeysRef.current = cacheKeys;");
    expect(projectionCommit).toContain(
      "itemIdsRef.current = projectionIndex.itemIds;"
    );
    expect(documentSessionRuntime).toContain(
      "itemCacheKeysRef.current.set(item.id, item.cacheKey);"
    );
    expect(reviewRuntime).not.toContain("new Map(itemCacheKeysRef.current)");
    // 金标准：content-bearing projectReviewLedger；禁止 selectMembers 驱动投影 id
    expect(documentSessionRuntime).toContain("projectReviewLedger(");
    expect(documentSessionRuntime).not.toContain(
      "selectCodeViewMemberEntryKeys({"
    );
    expect(documentSessionRuntime).toContain(
      "generationCallbacksRef.current.applyItemUpdates("
    );
    expect(itemReplay).toContain("handle.updateItems(items, {");
    // 代际 effect：阅读 refresh 闸门先于 generation 递增
    expect(documentSessionRuntime).toContain("beginReadingRefresh()");
    expect(documentSession).toContain(
      "mountGitReviewDocumentGeneration(options)"
    );
    expect(documentGenerationEffect).toMatch(
      /generationCallbacksRef\.current\.beginReadingRefresh\(\);\s*const generation = Math\.max\(/u
    );
    expect(documentSessionRuntime).toContain("syncReadingPinnedPrefix({");
    expect(documentSessionRuntime).toContain("pinnedPrefixEntryKeys");
    expect(documentSessionRuntime).toContain("readingMode");
    expect(reviewContent).not.toContain("diffHandleRef.current = null");
    // demand 预取覆盖；body 只接纳 loaded（≠ 显示 id 集）
    expect(documentSessionRuntime).toContain("nextDemandPrefetchEntryKeys(");
    expect(documentSessionRuntime).toContain(
      'resourceByEntryKey.get(entryKey)?.kind === "loaded"'
    );
    // session 代际预热 + projection commit 刷新（beginGeneration 不得读空/旧 map）
    expect(
      reviewRuntime.match(/entryKeyBySectionIdRef\.current\s*=/gu)
    ).toHaveLength(2);
    expect(documentSessionRuntime).toContain(
      "entryKeyBySectionIdRef.current = indexReviewSectionEntries(entries, diffBase)"
    );
    // projection-commit 写正式账本；session 在 setProjection 热路径同步写，避免 commit 前二次误判 membership
    expect(
      reviewRuntime.match(/itemIdsRef\.current\s*=/gu)?.length
    ).toBeGreaterThanOrEqual(1);
    expect(
      reviewRuntime.match(/renderedGenerationRef\.current\s*=/gu)
    ).toHaveLength(1);
    expect(reviewRuntime.match(/itemCacheKeysRef\.current\s*=/gu)).toHaveLength(
      1
    );
  });

  it("五个公开操作逐层接线到真实面板消费者", async () => {
    const [
      facade,
      host,
      permissions,
      preloadBase,
      preloadReview,
      router,
      service,
    ] = await Promise.all(
      [
        "src/plugins/api/renderer-facades.ts",
        "src/renderer/lib/plugins/host/git-context.ts",
        "src/main/app-core/permissions.ts",
        "src/preload/git-api.ts",
        "src/preload/git-review-api.ts",
        "src/main/app-core/commands/git-review.ts",
        "src/main/services/git-review/service.ts",
      ].map((file) => readFile(join(ROOT, file), "utf8"))
    );
    const preload = `${preloadBase}\n${preloadReview}`;
    const layers = { facade, host, permissions, preload, router, service };
    const rendererFiles = await sourceFiles(
      join(ROOT, "src/plugins/builtin/git/renderer")
    );
    const rendererSources = new Map(
      await Promise.all(
        rendererFiles.map(
          async (file) => [file, await readFile(file, "utf8")] as const
        )
      )
    );
    const operations = [
      {
        command: "git.getReviewIndex",
        consumers: [
          "src/plugins/builtin/git/renderer/hooks/use-changes-panel-index-state.ts",
        ],
        method: "getReviewIndex",
        service: "getIndex",
      },
      {
        command: "git.getReviewFileDocument",
        consumers: [
          "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts",
        ],
        method: "getReviewFileDocument",
        service: "getFileDocument",
      },
      {
        command: "git.cancelReviewRequest",
        consumers: [
          "src/plugins/builtin/git/renderer/hooks/use-changes-panel-index-state.ts",
          "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts",
        ],
        method: "cancelReviewRequest",
        service: "cancelReviewRequest",
      },
      {
        command: "git.applyReviewMutation",
        consumers: [
          "src/plugins/builtin/git/renderer/hooks/use-code-mutations.ts",
        ],
        method: "applyReviewMutation",
        service: "applyMutation",
      },
      {
        command: "git.applyReviewPathMutation",
        consumers: ["src/plugins/builtin/git/renderer/review/tree-actions.ts"],
        method: "applyReviewPathMutation",
        service: "applyPathMutation",
      },
    ] as const;

    for (const operation of operations) {
      expect(layers.permissions).toContain(`"${operation.command}":`);
      expect(layers.preload).toContain(`type: "${operation.command}"`);
      expect(layers.router).toContain(`"${operation.command}"`);
      expect(layers.router).toContain(
        `services.gitReview.${operation.service}(`
      );
      expect(layers.service).toMatch(
        new RegExp(`\\b${operation.service}\\(`, "u")
      );
      expect(layers.facade).toMatch(
        new RegExp(`\\b${operation.method}\\(`, "u")
      );
      expect(layers.host).toContain(`window.pier.git.${operation.method}(`);
      const consumers = [...rendererSources]
        .filter(([, source]) =>
          new RegExp(
            `context\\.git\\s*\\.\\s*${operation.method}\\(`,
            "u"
          ).test(source)
        )
        .map(([file]) => relative(ROOT, file));
      expect(consumers).toEqual(operation.consumers);
    }
  });

  it("锁定 Changes unmountWhenHidden 与 session keep-alive 接线", async () => {
    const [
      indexSource,
      workerSource,
      appShellSource,
      diffWorkerHostSource,
      sessionCacheSource,
      documentLoaderSource,
      documentSessionSource,
      changesPanelSource,
      changesPanelStateSource,
    ] = await Promise.all(
      [
        "src/plugins/builtin/git/renderer/index.ts",
        "packages/ui/src/diff-view/worker.tsx",
        "src/renderer/components/common/app-shell.tsx",
        "src/renderer/components/common/diff-worker-host.tsx",
        "src/plugins/builtin/git/renderer/review/session-cache.ts",
        "src/plugins/builtin/git/renderer/review/document/loader.ts",
        "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts",
        "src/plugins/builtin/git/renderer/changes-panel.tsx",
        "src/plugins/builtin/git/renderer/hooks/use-changes-panel-index-state.ts",
      ].map((file) => readFile(join(ROOT, file), "utf8"))
    );

    expect(indexSource).toContain('resourcePolicy: "unmountWhenHidden"');
    expect(workerSource).toContain("export function PierDiffWorkerHost");
    expect(workerSource).toContain("const existingPool = useWorkerPool()");
    expect(diffWorkerHostSource).toContain("PierDiffWorkerHost");
    expect(appShellSource).toContain("<DiffWorkerHost>");
    expect(sessionCacheSource).toContain("export function readReviewSession");
    expect(sessionCacheSource).toContain("export function writeReviewSession");
    expect(sessionCacheSource).toContain("export function patchReviewSession");
    expect(sessionCacheSource).toContain("export function clearReviewSession");
    expect(documentLoaderSource).toContain("hydrateLoaded(");
    expect(documentSessionSource).toContain("readReviewSession");
    expect(documentSessionSource).toContain("loader.hydrateLoaded");
    // uncommitted 也 hydrate soft-retain：否则 stage 切面/冷开已暂存会长期 estimate
    expect(documentSessionSource).toContain(
      "loader.hydrateLoaded(previousByEntryKey)"
    );
    expect(changesPanelStateSource).toContain("readReviewSession");
    expect(changesPanelStateSource).toContain("patchReviewSession");
    expect(changesPanelSource).toContain("clearReviewSession");
    expect(changesPanelStateSource).not.toMatch(
      /setBoundState\(\{\s*snapshot:\s*\{\s*kind:\s*"loading"/u
    );
  });
});
