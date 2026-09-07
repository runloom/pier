// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminalDraftStore } from "../../../../../src/main/state/terminal-drafts/store.ts";

const directories: string[] = [];
async function storePath() {
  const directory = await mkdtemp(join(tmpdir(), "pier-draft-test-"));
  directories.push(directory);
  return join(directory, "drafts.json");
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("unsent terminal draft persistence", () => {
  it("restores rich attachments and preserves same-text attachment edits during a send", async () => {
    const path = await storePath();
    const store = createTerminalDraftStore(path);
    const composition = {
      editorJson: '{"root":{}}',
      editorText: "task",
      attachments: [
        { id: "a", kind: "file" as const, name: "a.txt", path: "/tmp/a.txt" },
      ],
    };
    await store.write("w", "p", { text: "task", revision: 0, composition });
    expect(
      (await createTerminalDraftStore(path).read("w", "p")).composition
    ).toEqual(composition);
    const checkpoint = await store.beginSend("w", "p", "task");
    const current = await store.read("w", "p");
    const next = {
      ...composition,
      attachments: [
        ...composition.attachments,
        { id: "b", kind: "file" as const, name: "b.txt", path: "/tmp/b.txt" },
      ],
    };
    await store.write("w", "p", {
      text: "task",
      revision: current.revision,
      composition: next,
    });
    await store.move("w", "target", "p");
    await store.finishSend("w", "p", checkpoint, "submitted");
    expect(await store.read("target", "p")).toMatchObject({
      text: "task",
      composition: next,
    });
  });
  it("does not overwrite the user's unsent draft with programmatic input", async () => {
    const store = createTerminalDraftStore(await storePath());
    await store.write("w", "p", { text: "my unsent task", revision: 0 });
    const checkpoint = await store.beginSend("w", "p", "delegated follow-up");
    await store.finishSend("w", "p", checkpoint, "submitted");
    expect(await store.read("w", "p")).toMatchObject({
      text: "my unsent task",
    });
  });
  it("acknowledges only durable drafts and restores them after a new host", async () => {
    const path = await storePath();
    const store = createTerminalDraftStore(path);
    await store.write("window-record", "panel", {
      text: "原始任务\nnext line",
      revision: 0,
    });
    expect(await readFile(path, "utf8")).toContain("原始任务");
    const restored = await createTerminalDraftStore(path).read(
      "window-record",
      "panel"
    );
    expect(restored).toMatchObject({
      text: "原始任务\nnext line",
      status: "draft",
    });
  });

  it("restores a crashed send as unconfirmed without replaying it", async () => {
    const path = await storePath();
    const store = createTerminalDraftStore(path);
    await store.write("w", "p", { text: "original", revision: 0 });
    await store.beginSend("w", "p", "original");
    expect(await createTerminalDraftStore(path).read("w", "p")).toMatchObject({
      text: "original",
      status: "unconfirmed",
    });
  });

  it("keeps an edited next draft when the preceding submission succeeds", async () => {
    const store = createTerminalDraftStore(await storePath());
    const first = await store.write("w", "p", { text: "first", revision: 0 });
    const checkpoint = await store.beginSend("w", "p", first.text);
    const sending = await store.read("w", "p");
    await store.write("w", "p", { text: "next", revision: sending.revision });
    await store.finishSend("w", "p", checkpoint, "submitted");
    expect(await store.read("w", "p")).toMatchObject({
      text: "next",
      status: "draft",
    });
  });

  it("retains a partially delivered task and rejects a stale overwrite", async () => {
    const store = createTerminalDraftStore(await storePath());
    await store.write("w", "p", { text: "first", revision: 0 });
    const checkpoint = await store.beginSend("w", "p", "first");
    await store.finishSend("w", "p", checkpoint, "unconfirmed");
    await expect(
      store.write("w", "p", { text: "stale", revision: 1 })
    ).rejects.toThrow(/changed/);
    expect(await store.read("w", "p")).toMatchObject({
      text: "first",
      status: "unconfirmed",
    });
  });

  it("moves the latest draft atomically and refuses late writes from its previous owner", async () => {
    const store = createTerminalDraftStore(await storePath());
    await store.write("source", "p", { text: "task", revision: 0 });
    await store.move("source", "target", "p");
    await expect(
      store.write("source", "p", { text: "late", revision: 0 })
    ).rejects.toThrow(/moved/);
    expect(await store.read("target", "p")).toMatchObject({ text: "task" });
    expect(await store.read("source", "p")).toMatchObject({ text: "" });
  });

  it("clears confirmed submitted text but keeps a never delivered draft", async () => {
    const store = createTerminalDraftStore(await storePath());
    const checkpoint = await store.beginSend("w", "p", "task");
    await store.finishSend("w", "p", checkpoint, "not-delivered");
    expect(await store.read("w", "p")).toMatchObject({
      text: "task",
      status: "draft",
    });
    const retry = await store.beginSend("w", "p", "task");
    await store.finishSend("w", "p", retry, "submitted");
    expect(await store.read("w", "p")).toMatchObject({
      text: "",
      status: "draft",
    });
  });
});
