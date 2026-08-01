import { expect, test } from "@playwright/test";

import {
  createLspE2eFixture,
  type LspE2eFixture,
  readLspE2eReport,
  waitForEditorLspReady,
} from "../lsp/e2e-harness.ts";

test("app quit terminates every captured LSP process tree", async () => {
  test.setTimeout(120_000);
  let fixture: LspE2eFixture | undefined;

  try {
    fixture = await createLspE2eFixture();
    await fixture.openFile("first.ts");
    await waitForEditorLspReady(fixture);

    const runningSessions = await fixture.observerSnapshot();
    expect(runningSessions.length).toBeGreaterThan(0);
    for (const session of runningSessions) {
      expect(session.closeCause).toBeNull();
      expect(session.treeTerminal).toBe(false);
      expect(session.alive).toBe(true);
    }

    await fixture.application.close();
    fixture.markApplicationClosed();

    const report = await readLspE2eReport(fixture.reportPath);
    expect(report.shutdownCompleted).toBe(true);
    expect(report.sessions.length).toBeGreaterThan(0);
    expect(report.liveProcessTrees).toEqual([]);
    for (const session of report.sessions) {
      expect(session.closeCause, session.sessionId).toBe("app-quit");
      expect(session.treeTerminal, session.sessionId).toBe(true);
      expect(session.alive, session.sessionId).toBe(false);
    }
  } finally {
    await fixture?.cleanup();
  }
});
