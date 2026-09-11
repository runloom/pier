import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import {
  bootstrapParentAgent,
  captureTestAppErrors,
  closeTestApp,
  fakeAgentEnv,
  installFakeAgent,
  OUT_MAIN,
  runPierCli,
  type StartOk,
  screenContainsMarker,
  waitForPierCli,
  waitForTerminalPanelCount,
} from "./subagent-harness.ts";

test.skip(process.platform !== "darwin", "native terminal is macOS-only");
test("native approval continues once and unverified agent drafts survive restart", async () => {
  test.setTimeout(180_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-draft-e2e-"));
  const fakeBin = installFakeAgent();
  const launch = () =>
    electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      env: fakeAgentEnv(userDataDir, fakeBin),
    });
  let app = await launch();
  await captureTestAppErrors(
    app,
    test.info().outputPath("electron.stderr.log")
  );
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await waitForPierCli(userDataDir);
    const origin = await bootstrapParentAgent(userDataDir);
    const task = "ORIGINAL_NATIVE_TASK";
    const started = runPierCli(
      userDataDir,
      ["agents", "start", "codex", "--stdin"],
      { origin, stdin: task }
    );
    expect(started.json?.ok, JSON.stringify(started)).toBe(true);
    expect(started.json?.data?.inputDisposition).toBe("native-launch");
    const child = started.json?.data as unknown as StartOk;
    await expect
      .poll(() => existsSync(join(fakeBin, `${child.panelId}.argv.json`)))
      .toBe(true);
    await screenContainsMarker(userDataDir, origin, child, "Hooks need review");
    const blocked = runPierCli(
      userDataDir,
      [
        "agents",
        "turn",
        "--boot",
        child.runtime.bootId,
        "--runtime",
        child.runtime.runtimeId,
        "--generation",
        String(child.runtime.generation),
        "--stdin",
      ],
      { origin, stdin: "FOLLOWUP_DRAFT" }
    );
    expect(blocked.json?.ok).toBe(false);
    expect(
      (
        await win.evaluate(
          (panelId) => window.pier.terminal.readDraft(panelId),
          child.panelId
        )
      ).text
    ).toContain("FOLLOWUP_DRAFT");
    await win.evaluate(
      (panelId) =>
        window.pier.terminal.sendKeyPress({
          panelId,
          keycode: 36,
          mods: 0,
          text: "\r",
        }),
      child.panelId
    );
    await screenContainsMarker(userDataDir, origin, child, "CONTINUED_ONCE");
    const argv = JSON.parse(
      readFileSync(join(fakeBin, `${child.panelId}.continued.json`), "utf8")
    ) as string[];
    expect(argv.filter((arg) => arg.includes(task))).toHaveLength(1);

    const fallback = runPierCli(
      userDataDir,
      ["agents", "start", "aider", "--stdin"],
      { origin, stdin: "UNSENT_AFTER_RESTART" }
    );
    expect(fallback.json?.ok, JSON.stringify(fallback)).toBe(true);
    expect(fallback.json?.data?.inputDisposition).toBe("draft");
    const panelId = (fallback.json?.data as unknown as StartOk).panelId;
    expect(runPierCli(userDataDir, ["panels", "focus", panelId]).json?.ok).toBe(
      true
    );
    await expect(win.getByTestId("terminal-composer-input")).toContainText(
      "UNSENT_AFTER_RESTART"
    );
    await win
      .getByTestId("terminal-composer-input")
      .fill("EDITED_UNSENT_DRAFT");
    await expect
      .poll(
        async () =>
          (
            await win.evaluate(
              (id) => window.pier.terminal.readDraft(id),
              panelId
            )
          ).text
      )
      .toBe("EDITED_UNSENT_DRAFT");
    await win.screenshot({ path: test.info().outputPath("saved-draft.png") });
    await closeTestApp(app);
    app = await launch();
    await captureTestAppErrors(
      app,
      test.info().outputPath("restored-electron.stderr.log")
    );
    const restored = await app.firstWindow();
    await restored.waitForLoadState("domcontentloaded");
    await waitForPierCli(userDataDir);
    await waitForTerminalPanelCount(userDataDir, 4);
    const draft = await restored.evaluate(
      (id) => window.pier.terminal.readDraft(id),
      panelId
    );
    expect(draft).toMatchObject({
      text: "EDITED_UNSENT_DRAFT",
      status: "draft",
    });
    expect(runPierCli(userDataDir, ["panels", "focus", panelId]).json?.ok).toBe(
      true
    );
    await expect(restored.getByTestId("terminal-composer-input")).toContainText(
      "EDITED_UNSENT_DRAFT"
    );
    await restored.screenshot({
      path: test.info().outputPath("restored-draft.png"),
    });
  } finally {
    await closeTestApp(app);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});
