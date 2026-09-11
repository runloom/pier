import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
} from "./subagent-harness.ts";

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

function target(child: StartOk): string[] {
  return [
    "--boot",
    child.runtime.bootId,
    "--runtime",
    child.runtime.runtimeId,
    "--generation",
    String(child.runtime.generation),
  ];
}

test("native prompt, interrupt, stop escalation and retained output form one lifecycle", async () => {
  test.setTimeout(180_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-lifecycle-e2e-"));
  const fakeBin = installFakeAgent();
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    env: fakeAgentEnv(userDataDir, fakeBin),
  });
  await captureTestAppErrors(
    app,
    test.info().outputPath("electron.stderr.log")
  );
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await waitForPierCli(userDataDir);
    const origin = await bootstrapParentAgent(userDataDir);
    const prompt =
      "TEST_STUBBORN_MODE 原始任务 'quoted' $(literal)\nnext line\n";
    const started = runPierCli(
      userDataDir,
      ["agents", "start", "claude", "--stdin"],
      { origin, stdin: prompt }
    );
    expect(started.json?.ok, JSON.stringify(started)).toBe(true);
    const child = started.json?.data as unknown as StartOk;
    expect(started.json?.data?.inputDisposition).toBe("native-launch");
    await screenContainsMarker(userDataDir, origin, child, "STUBBORN_READY:");
    const argv = JSON.parse(
      readFileSync(join(fakeBin, `${child.panelId}.argv.json`), "utf8")
    ) as string[];
    expect(
      argv.filter((arg) => arg.includes("TEST_STUBBORN_MODE"))
    ).toHaveLength(1);
    expect(argv.at(-1)).toContain(prompt);

    const interrupted = runPierCli(
      userDataDir,
      ["agents", "interrupt", ...target(child)],
      { origin }
    );
    expect(interrupted.json?.ok, JSON.stringify(interrupted)).toBe(true);
    await screenContainsMarker(
      userDataDir,
      origin,
      child,
      "NATIVE_SIGINT_RECEIVED"
    );
    const grandchild = Number(
      readFileSync(join(fakeBin, `${child.panelId}.child.pid`), "utf8")
    );
    expect(() => process.kill(grandchild, 0)).not.toThrow();
    const stopped = runPierCli(
      userDataDir,
      ["agents", "terminate", ...target(child)],
      { origin }
    );
    expect(stopped.json?.ok, JSON.stringify(stopped)).toBe(true);
    await expect
      .poll(() => {
        try {
          process.kill(grandchild, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await screenContainsMarker(
      userDataDir,
      origin,
      child,
      "NATIVE_SIGINT_RECEIVED"
    );
    const panels = runPierCli(userDataDir, ["panels", "list"]);
    expect(JSON.stringify(panels.json?.data)).toContain(child.panelId);
    expect(
      runPierCli(userDataDir, ["agents", "turn", ...target(child), "--stdin"], {
        origin,
        stdin: "must not deliver",
      }).json?.ok
    ).toBe(false);
    await win.screenshot({ path: test.info().outputPath("stopped-panel.png") });
  } finally {
    await closeTestApp(app);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("agent natural exit keeps the panel and retained output", async () => {
  test.setTimeout(180_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-lifecycle-exit-e2e-"));
  const fakeBin = installFakeAgent();
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    env: fakeAgentEnv(userDataDir, fakeBin),
  });
  await captureTestAppErrors(
    app,
    test.info().outputPath("electron.stderr.log")
  );
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await waitForPierCli(userDataDir);
    const origin = await bootstrapParentAgent(userDataDir);
    const started = runPierCli(
      userDataDir,
      ["agents", "start", "claude", "--stdin"],
      { origin, stdin: "TEST_EXIT_MODE keep-scrollback\n" }
    );
    expect(started.json?.ok, JSON.stringify(started)).toBe(true);
    const child = started.json?.data as unknown as StartOk;
    await screenContainsMarker(userDataDir, origin, child, "EXIT_READY");
    await expect
      .poll(() => {
        const panels = runPierCli(userDataDir, ["panels", "list"]);
        return JSON.stringify(panels.json?.data ?? {}).includes(child.panelId);
      })
      .toBe(true);
    await screenContainsMarker(userDataDir, origin, child, "EXIT_READY");
    expect(
      runPierCli(userDataDir, ["agents", "turn", ...target(child), "--stdin"], {
        origin,
        stdin: "must not deliver",
      }).json?.ok
    ).toBe(false);
  } finally {
    await closeTestApp(app);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});
