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
      } else if (specifier === "@pier/ui/diff-view.tsx") {
        pending.push(join(ROOT, "packages/ui/src/diff-view.tsx"));
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
      "packages/ui/src/diff-view-items.ts",
      "packages/ui/src/diff-view-pointer-selection.ts",
      "packages/ui/src/diff-view-selection-text.ts",
      "packages/ui/src/diff-view-worker.tsx",
      "packages/ui/src/diff-view.tsx",
      "packages/ui/src/use-diff-view-handle.ts",
      "packages/ui/src/use-diff-view-headers.tsx",
      "packages/ui/src/use-diff-view-item-apply.ts",
    ]);
  });

  it("锁定官方正文边界、配置和根容器且不恢复自绘正文", async () => {
    const uiFiles = await sourceFiles(join(ROOT, "packages/ui/src"));
    const source = await readFile(
      join(ROOT, "packages/ui/src/diff-view.tsx"),
      "utf8"
    );
    const appearanceSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view-appearance.ts"),
      "utf8"
    );
    const collapseSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view-collapse.tsx"),
      "utf8"
    );
    const workerSource = await readFile(
      join(ROOT, "packages/ui/src/diff-view-worker.tsx"),
      "utf8"
    );
    const customCss = appearanceSource.match(
      /const CODE_VIEW_CUSTOM_CSS = `([\s\S]*?)`;/u
    )?.[1];
    const codeViewOptions = source.match(
      /const options = useMemo<CodeViewOptions<undefined>>\(\n\s+\(\) => \(\{([\s\S]*?)\n\s+\}\),\n\s+\[[\s\S]*?\n\s+\]\n\s+\);/u
    )?.[1];

    expect(uiFiles.map((file) => relative(ROOT, file))).not.toContain(
      "packages/ui/src/diff-view/diff-view-profile.ts"
    );
    expect(workerSource).toContain("worker/worker.js");
    expect(source).toContain('preferredHighlighter: "shiki-wasm"');
    // diffStyle/overflow 由 PierDiffViewPresentation 驱动(split/unified、wrap),
    // 缺省仍是 split + scroll;其余配置保持锁定。
    expect(codeViewOptions?.trim()).toBe(
      `diffIndicators: "bars",
      diffStyle,
      disableBackground: false,
      disableLineNumbers: false,
      enableGutterUtility: false,
      enableLineSelection: true,
      itemMetrics: {
        diffHeaderHeight: metrics.diffHeaderHeight,
        lineHeight: metrics.lineHeight,
      },
      layout: { gap: 1, paddingBottom: 0, paddingTop: 0 },
      lineHoverHighlight: "number",
      onPostRender(element, _instance, phase, context) {
        if (phase !== "unmount") {
          markRendered(context.item.id, context.version, element);
        }
        const viewer = codeViewRef.current?.getInstance();
        stabilizeCodeViewStickyPositioning(viewer);
        scheduleRenderWindowReport();
      },
      overflow,
      preferredHighlighter: "shiki-wasm",
      stickyHeaders: true,
      theme: appearance.codeTheme,
      themeType: appearance.colorMode,
      unsafeCSS: CODE_VIEW_CUSTOM_CSS,`
    );
    expect(source).toContain(
      'const diffStyle = presentation?.diffStyle ?? "split";'
    );
    expect(source).toContain(
      'const overflow = presentation?.wrapLines === true ? "wrap" : "scroll";'
    );
    expect(source.match(/unsafeCSS:/gu)).toHaveLength(1);
    expect(appearanceSource).toContain("SCROLLBAR_SYSTEM_CSS");
    expect(appearanceSource).toContain('from "./scrollbar-system.ts"');
    expect(customCss).toBeDefined();
    expect(/\$\{SCROLLBAR_SYSTEM_CSS\}/.test(customCss ?? "")).toBe(true);
    expect(appearanceSource).toContain("DIFF_HEADER_HEIGHT_PX = 32");
    expect(appearanceSource).toContain("min-height: 32px");
    expect(source).toContain('from "./diff-view-sticky-stabilize.ts"');
    expect(source).toContain("stabilizeCodeViewStickyPositioning(viewer)");
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
    expect(`${source}\n${appearanceSource}`).not.toMatch(
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
      "packages/ui/src/diff-view.tsx",
      "src/plugins/builtin/git/renderer/git-changes-panel.tsx",
    ]);
    const violations: string[] = [];
    for (const [file, source] of reviewSources) {
      const isAdapter = [
        join(ROOT, "packages/ui/src/diff-view.tsx"),
        join(ROOT, "packages/ui/src/use-diff-view-handle.ts"),
        join(ROOT, "packages/ui/src/use-diff-view-headers.tsx"),
        join(ROOT, "packages/ui/src/use-diff-view-item-apply.ts"),
      ].includes(file);
      if (
        /\b(?:addItems|updateItemId|WorkerPoolManager)\b/u.test(source) ||
        (!isAdapter && /\bupdateItem\b/u.test(source)) ||
        source.includes("shadowRoot")
      ) {
        violations.push(relative(ROOT, file));
      }
    }

    expect(violations).toEqual([]);
    const adapter = [
      reviewSources.get(join(ROOT, "packages/ui/src/diff-view.tsx")),
      reviewSources.get(join(ROOT, "packages/ui/src/use-diff-view-handle.ts")),
      reviewSources.get(
        join(ROOT, "packages/ui/src/use-diff-view-headers.tsx")
      ),
      reviewSources.get(
        join(ROOT, "packages/ui/src/use-diff-view-item-apply.ts")
      ),
    ].join("\n");
    expect(adapter).toContain("getInstance()");
    expect(adapter).toContain("getRenderedItems()");
    expect(adapter).toContain("initialItems={codeViewItems}");
    expect(adapter).toContain("handle.updateItem(item)");
    expect(adapter).not.toContain("items={codeViewItems}");
    expect(adapter).not.toMatch(/querySelector|shadowRoot/u);
    const changesSources = await localDependencySources([
      "src/plugins/builtin/git/renderer/git-changes-panel.tsx",
    ]);
    expect([...changesSources.values()].join("\n")).not.toMatch(
      /role=["']tree(?:item)?["']|<(?:li|ul)\b|@tanstack\/react-virtual/iu
    );
  });

  it("冻结三个 Review 命令并要求 Changes 继续复用 PierFileTree", async () => {
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
    ]);

    const reviewContent = await readFile(
      join(ROOT, "src/plugins/builtin/git/renderer/git-review-content.tsx"),
      "utf8"
    );
    const reviewDocumentView = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/git-review-document-view.tsx"
      ),
      "utf8"
    );
    const projectionCommit = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/use-git-review-projection-commit.ts"
      ),
      "utf8"
    );
    const itemReplay = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/use-git-review-item-replay.ts"
      ),
      "utf8"
    );
    const documentSession = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/use-git-review-document-session.ts"
      ),
      "utf8"
    );
    const reviewRuntime = `${reviewContent}\n${projectionCommit}\n${itemReplay}\n${documentSession}`;
    const reviewPanelLayout = await readFile(
      join(
        ROOT,
        "src/plugins/builtin/git/renderer/git-review-panel-layout.tsx"
      ),
      "utf8"
    );
    expect(reviewPanelLayout).toContain(
      'import { PierFileTree } from "@pier/ui/file-tree.tsx";'
    );
    expect(reviewPanelLayout.match(/<PierFileTree\b/gu)).toHaveLength(1);
    expect(reviewDocumentView).toContain("<GitReviewPanelLayout");
    expect(projectionCommit).toContain(
      "renderedGenerationRef.current = projectionGeneration;"
    );
    expect(projectionCommit).toContain(
      "entryKeyBySectionIdRef.current = projection.entryKeyBySectionId;"
    );
    expect(projectionCommit).toContain("itemCacheKeysRef.current = cacheKeys;");
    expect(projectionCommit).toContain(
      "itemIdsRef.current = projectionIndex.itemIds;"
    );
    expect(documentSession).toContain(
      "itemCacheKeysRef.current.set(item.id, item.cacheKey);"
    );
    expect(reviewRuntime).not.toContain("new Map(itemCacheKeysRef.current)");
    expect(documentSession).toContain("projectReviewDocumentResource(");
    expect(documentSession).toContain(
      "generationCallbacksRef.current.applyItemUpdates("
    );
    expect(itemReplay).toContain("handle.updateItems(items, {");
    expect(documentSession).toContain(
      "useEffect(() => {\n    const generation = Math.max("
    );
    expect(reviewContent).not.toContain("diffHandleRef.current = null");
    // demand 预取覆盖不是 CodeView 成员；全量轻量槽在 projectReviewDocuments。
    expect(documentSession).toContain("nextDemandPrefetchEntryKeys(");
    expect(documentSession).toContain("projectReviewDocuments(");
    expect(
      reviewRuntime.match(/entryKeyBySectionIdRef\.current\s*=/gu)
    ).toHaveLength(1);
    expect(reviewRuntime.match(/itemIdsRef\.current\s*=/gu)).toHaveLength(1);
    expect(
      reviewRuntime.match(/renderedGenerationRef\.current\s*=/gu)
    ).toHaveLength(1);
    expect(reviewRuntime.match(/itemCacheKeysRef\.current\s*=/gu)).toHaveLength(
      1
    );
  });

  it("三个公开操作逐层接线到真实面板消费者", async () => {
    const [facade, host, permissions, preload, router, service] =
      await Promise.all(
        [
          "src/plugins/api/renderer-facades.ts",
          "src/renderer/lib/plugins/host-git-context.ts",
          "src/main/app-core/permissions.ts",
          "src/preload/git-api.ts",
          "src/main/app-core/git-review-commands.ts",
          "src/main/services/git-review/git-review-service.ts",
        ].map((file) => readFile(join(ROOT, file), "utf8"))
      );
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
        consumers: ["src/plugins/builtin/git/renderer/git-changes-panel.tsx"],
        method: "getReviewIndex",
        service: "getIndex",
      },
      {
        command: "git.getReviewFileDocument",
        consumers: [
          "src/plugins/builtin/git/renderer/use-git-review-document-session.ts",
        ],
        method: "getReviewFileDocument",
        service: "getFileDocument",
      },
      {
        command: "git.cancelReviewRequest",
        consumers: [
          "src/plugins/builtin/git/renderer/git-changes-panel.tsx",
          "src/plugins/builtin/git/renderer/use-git-review-document-session.ts",
        ],
        method: "cancelReviewRequest",
        service: "cancelReviewRequest",
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
    ] = await Promise.all(
      [
        "src/plugins/builtin/git/renderer/index.ts",
        "packages/ui/src/diff-view-worker.tsx",
        "src/renderer/components/common/app-shell.tsx",
        "src/renderer/components/common/diff-worker-host.tsx",
        "src/plugins/builtin/git/renderer/git-review-session-cache.ts",
        "src/plugins/builtin/git/renderer/git-review-document-loader.ts",
        "src/plugins/builtin/git/renderer/use-git-review-document-session.ts",
        "src/plugins/builtin/git/renderer/git-changes-panel.tsx",
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
    expect(changesPanelSource).toContain("readReviewSession");
    expect(changesPanelSource).toContain("patchReviewSession");
    expect(changesPanelSource).toContain("clearReviewSession");
    expect(changesPanelSource).not.toMatch(
      /setBoundState\(\{\s*snapshot:\s*\{\s*kind:\s*"loading"/u
    );
  });
});
