import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import {
  agentsList,
  bootstrapParentAgent,
  captureTestAppErrors,
  closeTestApp,
  fakeAgentEnv,
  installFakeAgent,
  OUT_MAIN,
  runPierCli,
  runPierCliJson,
  type StartOk,
  screenContainsMarker,
  startChild,
  waitForPierCli,
  waitForTerminalPanelCount,
} from "./subagent-harness.ts";

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

test("agents start CLI parsing guards reject without touching the app", () => {
  const noSocket = "/tmp/pier-subagent-nosocket";
  const baseEnv = { PIER_PANEL_ID: "panel_x", PIER_WINDOW_ID: "win_x" };

  const disabled = runPierCli(
    noSocket,
    ["agents", "start", "claude", "--stdin"],
    {
      stdin: "hi",
      overrides: { ...baseEnv, PIER_AGENT_PANELS_DISABLED: "1" },
    }
  );
  expect(disabled.stderr).toContain("PIER_AGENT_PANELS_DISABLED");
  expect(disabled.code).toBe(1);

  const noOrigin = runPierCli(
    noSocket,
    ["agents", "start", "claude", "--stdin"],
    {
      stdin: "hi",
      overrides: { PIER_PANEL_ID: undefined, PIER_WINDOW_ID: undefined },
    }
  );
  expect(noOrigin.stderr).toContain("PIER_PANEL_ID");
  expect(noOrigin.code).toBe(1);

  const tooLong = runPierCli(
    noSocket,
    ["agents", "start", "claude", "--stdin"],
    {
      stdin: "a".repeat(70_000),
      overrides: baseEnv,
    }
  );
  expect(tooLong.stderr).toContain("prompt_too_long");
  expect(tooLong.code).toBe(5);
});

test("agents start delegation golden chain over real native terminals", async () => {
  test.setTimeout(240_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-subagent-e2e-"));
  const fakeBin = installFakeAgent();
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    env: fakeAgentEnv(userDataDir, fakeBin),
  });

  await captureTestAppErrors(
    app,
    test.info().outputPath("electron.stderr.log")
  );
  const done = (async () => {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await waitForPierCli(userDataDir);
    await waitForTerminalPanelCount(userDataDir, 1);

    const origin = await bootstrapParentAgent(userDataDir);

    // 金路径：委派成功 + marker 投递到真实 surface。
    const first = startChild(userDataDir, origin);
    expect(
      first.code,
      `first=${JSON.stringify(first)} entries=${JSON.stringify((await agentsList(userDataDir)).entries)}`
    ).toBe(0);
    expect(first.json?.ok).toBe(true);
    const child1 = first.json?.data as unknown as StartOk;
    expect(child1.runtime.runtimeId).toBeTruthy();

    await screenContainsMarker(
      userDataDir,
      origin,
      child1,
      `[Delegated by parent claude panel ${origin.panelId}]`
    );

    // 配额：默认 4；第 5 次 quota_exceeded(exit 4)。
    const second = startChild(userDataDir, origin);
    expect(second.json?.ok).toBe(true);
    const third = startChild(userDataDir, origin);
    expect(third.json?.ok).toBe(true);
    const fourth = startChild(userDataDir, origin);
    expect(fourth.json?.ok).toBe(true);
    const fifth = startChild(userDataDir, origin);
    expect(fifth.json?.ok).toBe(false);
    expect(fifth.json?.error?.code).toBe("quota_exceeded");
    expect(fifth.code).toBe(4);

    // 关闭一个子面板 → 释放占额 → 再 spawn 成功。
    await runPierCliJson(userDataDir, ["terminal", "close", child1.panelId]);
    await expect
      .poll(() => startChild(userDataDir, origin).json?.ok === true, {
        timeout: 15_000,
      })
      .toBe(true);

    // 跨窗拒绝：origin 有效但顶层 --window 指向别的窗口（fail-fast，不占额）。
    const crossWindow = runPierCli(
      userDataDir,
      ["agents", "start", "claude", "--stdin", "--window", "999999"],
      {
        origin,
        stdin: "hi",
      }
    );
    expect(crossWindow.json?.error?.code).toBe("cross_window_unsupported");
    expect(crossWindow.code).toBe(6);

    // 伪造 origin：invalid_origin(exit 3)。
    const ghost = runPierCli(userDataDir, ["agents", "start", "claude"], {
      origin: { panelId: "panel_ghost", windowId: origin.windowId },
      stdin: "hi",
    });
    expect(ghost.json?.error?.code).toBe("invalid_origin");
    expect(ghost.code).toBe(3);
  })();

  return done.finally(async () => {
    await closeTestApp(app);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });
});
