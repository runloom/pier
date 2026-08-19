import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  createLspE2eFixture,
  type LspE2eFixture,
  type LspE2eSessionSnapshot,
  languageStatus,
  observerClose,
  observerSnapshot,
  observerTerminate,
} from "../lsp/e2e-harness.ts";

type ObserverSessions = readonly LspE2eSessionSnapshot[];
type ObserverSession = LspE2eSessionSnapshot;
type PausedCause = "idle-release" | "workspace-evicted";

const STATUS_TIMEOUT_MS = 30_000;

function editorSessions(snapshot: ObserverSessions): ObserverSession[] {
  return [...snapshot];
}

function liveEditorSessions(snapshot: ObserverSessions): ObserverSession[] {
  return editorSessions(snapshot).filter((session) => session.alive);
}

async function expectLanguageStatuses(
  page: Page,
  state: "error" | "paused" | "retrying",
  count: number
): Promise<void> {
  await expect(languageStatus(page)).toHaveCount(count, {
    timeout: STATUS_TIMEOUT_MS,
  });
  await expect(languageStatus(page, state)).toHaveCount(count, {
    timeout: STATUS_TIMEOUT_MS,
  });
}

/** Ready is silent in chrome; assert no status chip and a live editor session. */
async function expectSilentLanguageReady(
  page: Page,
  application: ElectronApplication,
  liveEditorCount = 1
): Promise<void> {
  await expect(languageStatus(page, "ready")).toHaveCount(0, {
    timeout: STATUS_TIMEOUT_MS,
  });
  await expect(languageStatus(page)).toHaveCount(0, {
    timeout: STATUS_TIMEOUT_MS,
  });
  await expect
    .poll(
      async () =>
        liveEditorSessions(await observerSnapshot(application)).length,
      { timeout: STATUS_TIMEOUT_MS }
    )
    .toBe(liveEditorCount);
}

async function blurEditorFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  });
}

async function waitForOnlyLiveEditorSession(
  application: ElectronApplication
): Promise<ObserverSession> {
  let generation: ObserverSession | null = null;
  await expect
    .poll(
      async () => {
        const live = liveEditorSessions(await observerSnapshot(application));
        generation = live.length === 1 ? (live.at(0) ?? null) : null;
        return live.length;
      },
      { timeout: STATUS_TIMEOUT_MS }
    )
    .toBe(1);
  if (!generation) {
    throw new Error("Expected one live editor language-server generation");
  }
  return generation;
}

async function waitForReplacement(
  application: ElectronApplication,
  knownSessionIds: ReadonlySet<string>
): Promise<ObserverSession> {
  let replacement: ObserverSession | null = null;
  await expect
    .poll(
      async () => {
        const snapshot = await observerSnapshot(application);
        const newGenerations = editorSessions(snapshot).filter(
          (session) => !knownSessionIds.has(session.sessionId)
        );
        const live = liveEditorSessions(snapshot);
        const candidate =
          newGenerations.length === 1 ? newGenerations.at(0) : undefined;
        replacement =
          candidate?.alive === true && live.length === 1 ? candidate : null;
        return {
          liveEditorSessions: live.length,
          newEditorSessions: newGenerations.length,
        };
      },
      { timeout: STATUS_TIMEOUT_MS }
    )
    .toEqual({ liveEditorSessions: 1, newEditorSessions: 1 });
  if (!replacement) {
    throw new Error("Expected exactly one live replacement generation");
  }
  return replacement;
}

function recordGeneration(
  generation: ObserverSession,
  sessionIds: Set<string>,
  pids: Set<number>
): void {
  expect(generation.pid).not.toBeNull();
  if (generation.pid === null) {
    throw new Error(
      `Observer did not capture a PID for ${generation.sessionId}`
    );
  }
  expect(sessionIds.has(generation.sessionId)).toBe(false);
  expect(pids.has(generation.pid)).toBe(false);
  sessionIds.add(generation.sessionId);
  pids.add(generation.pid);
}

async function expectNoAdditionalEditorSessions(
  application: ElectronApplication,
  expectedSessionIds: ReadonlySet<string>,
  requiredStableSamples: number,
  intervals: number[],
  timeout: number
): Promise<void> {
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const observedIds = editorSessions(
          await observerSnapshot(application)
        ).map((session) => session.sessionId);
        const unchanged =
          observedIds.length === expectedSessionIds.size &&
          observedIds.every((sessionId) => expectedSessionIds.has(sessionId));
        stableSamples = unchanged ? stableSamples + 1 : 0;
        return stableSamples;
      },
      { intervals, timeout }
    )
    .toBe(requiredStableSamples);
}

async function focusEditor(page: Page): Promise<void> {
  const editor = page
    .locator('[data-testid="files-code-mirror-editor"] .cm-content')
    .last();
  await editor.click();
  await expect(editor).toBeFocused();
}

async function closeAndResume(
  fixture: LspE2eFixture,
  generation: ObserverSession,
  cause: PausedCause,
  sessionIds: Set<string>,
  pids: Set<number>
): Promise<ObserverSession> {
  // Ready no longer renders a focusable status chip; blur the editor instead.
  await blurEditorFocus(fixture.page);

  const pausedRendered = expectLanguageStatuses(fixture.page, "paused", 1);
  await Promise.all([
    pausedRendered,
    observerClose(fixture.application, generation.sessionId, cause),
  ]);

  const afterClose = await observerSnapshot(fixture.application);
  const closedGeneration = afterClose.find(
    (session) => session.sessionId === generation.sessionId
  );
  expect(closedGeneration).toMatchObject({
    alive: false,
    closeCause: cause,
    treeTerminal: true,
  });
  await expectNoAdditionalEditorSessions(
    fixture.application,
    sessionIds,
    4,
    [100, 250, 500, 1000],
    3000
  );

  await focusEditor(fixture.page);
  const replacement = await waitForReplacement(fixture.application, sessionIds);
  recordGeneration(replacement, sessionIds, pids);
  await expectSilentLanguageReady(fixture.page, fixture.application);
  return replacement;
}

async function splitPinnedFileIntoRightGroup(
  page: Page,
  fileName: string
): Promise<void> {
  const tab = page
    .locator('[data-panel-tab-id^="pier.files.filePanel:disk:"]')
    .filter({ hasText: fileName })
    .last();
  const source = tab.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-tab ')][1]"
  );
  const group = tab.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-groupview ')][1]"
  );
  const target = group.locator(":scope > .dv-content-container");
  const [sourceBox, targetBox] = await Promise.all([
    source.boundingBox(),
    target.boundingBox(),
  ]);
  if (!(sourceBox && targetBox)) {
    throw new Error("Files split drag has no stable geometry");
  }

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width * 0.9,
    targetBox.y + targetBox.height / 2,
    { steps: 24 }
  );
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect(page.locator(".dv-groupview")).toHaveCount(2, {
    timeout: STATUS_TIMEOUT_MS,
  });
}

test("two TypeScript views share one session and one reconnect generation", async () => {
  test.setTimeout(90_000);
  const fixture = await createLspE2eFixture();
  try {
    await fixture.openFile("first.ts", { pin: true });
    await expectSilentLanguageReady(fixture.page, fixture.application);
    await fixture.openFile("second.ts");
    await expectSilentLanguageReady(fixture.page, fixture.application);
    await splitPinnedFileIntoRightGroup(fixture.page, "first.ts");
    // Two editor chrome areas when split; both stay silent when ready.
    await expectSilentLanguageReady(fixture.page, fixture.application);

    const initial = await waitForOnlyLiveEditorSession(fixture.application);
    expect(initial.pid).not.toBeNull();
    const initialSnapshot = await observerSnapshot(fixture.application);
    const baselineSessions = editorSessions(initialSnapshot);
    const baselineSessionIds = new Set(
      baselineSessions.map((session) => session.sessionId)
    );
    expect(liveEditorSessions(initialSnapshot)).toEqual([initial]);

    const retryingRendered = expectLanguageStatuses(
      fixture.page,
      "retrying",
      2
    );
    await Promise.all([
      retryingRendered,
      observerTerminate(fixture.application, initial.sessionId),
    ]);

    const replacement = await waitForReplacement(
      fixture.application,
      baselineSessionIds
    );
    expect(replacement.sessionId).not.toBe(initial.sessionId);
    expect(replacement.pid).not.toBeNull();
    expect(replacement.pid).not.toBe(initial.pid);
    expect(replacement).toMatchObject({
      rootPath: initial.rootPath,
      serverId: initial.serverId,
      workspaceKey: initial.workspaceKey,
    });
    const terminatedInitial = (
      await observerSnapshot(fixture.application)
    ).find((session) => session.sessionId === initial.sessionId);
    expect(terminatedInitial).toMatchObject({
      alive: false,
      closeCause: null,
      treeTerminal: true,
    });
    await expectSilentLanguageReady(fixture.page, fixture.application);

    const finalSnapshot = await observerSnapshot(fixture.application);
    expect(editorSessions(finalSnapshot)).toHaveLength(
      baselineSessions.length + 1
    );
    expect(liveEditorSessions(finalSnapshot)).toEqual([replacement]);
    expect(
      editorSessions(finalSnapshot).filter(
        (session) => !baselineSessionIds.has(session.sessionId)
      )
    ).toEqual([replacement]);
  } finally {
    await fixture.cleanup();
  }
});

test("policy closes pause until focus and unstable generations exhaust retries", async () => {
  test.setTimeout(120_000);
  const fixture = await createLspE2eFixture();
  try {
    await fixture.openFile("first.ts", { pin: true });
    await expectSilentLanguageReady(fixture.page, fixture.application);

    let generation = await waitForOnlyLiveEditorSession(fixture.application);
    const sessionIds = new Set<string>();
    const pids = new Set<number>();
    recordGeneration(generation, sessionIds, pids);

    generation = await closeAndResume(
      fixture,
      generation,
      "idle-release",
      sessionIds,
      pids
    );
    generation = await closeAndResume(
      fixture,
      generation,
      "workspace-evicted",
      sessionIds,
      pids
    );

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const retryingRendered = expectLanguageStatuses(
        fixture.page,
        "retrying",
        1
      );
      await Promise.all([
        retryingRendered,
        observerTerminate(fixture.application, generation.sessionId),
      ]);

      generation = await waitForReplacement(fixture.application, sessionIds);
      recordGeneration(generation, sessionIds, pids);
      await expectSilentLanguageReady(fixture.page, fixture.application);
    }

    const exhaustedRendered = expectLanguageStatuses(fixture.page, "error", 1);
    await Promise.all([
      exhaustedRendered,
      observerTerminate(fixture.application, generation.sessionId),
    ]);

    const errorStatus = languageStatus(fixture.page, "error");
    await errorStatus.hover();
    await expect(fixture.page.getByRole("tooltip")).toContainText(
      /stopped repeatedly|语言服务器反复停止/u,
      { timeout: 10_000 }
    );

    await expectNoAdditionalEditorSessions(
      fixture.application,
      sessionIds,
      6,
      [250, 500, 1000, 2000, 2500],
      7500
    );
    expect(
      liveEditorSessions(await observerSnapshot(fixture.application))
    ).toHaveLength(0);
    const finalSessions = editorSessions(
      await observerSnapshot(fixture.application)
    );
    expect(finalSessions.map((session) => session.sessionId)).toEqual([
      ...sessionIds,
    ]);
    expect(finalSessions.map((session) => session.closeCause)).toEqual([
      "idle-release",
      "workspace-evicted",
      null,
      null,
      null,
      null,
    ]);
    expect(
      finalSessions.every((session) => session.treeTerminal && !session.alive)
    ).toBe(true);
    expect(sessionIds.size).toBe(6);
    expect(pids.size).toBe(6);
  } finally {
    await fixture.cleanup();
  }
});
