import { describe, expect, it } from "vitest";
import {
  buildComposerSendText,
  type ComposerAttachment,
  MAX_COMPOSER_SEND_TEXT_LENGTH,
} from "@/panel-kits/terminal/composer-attachments-model.ts";

function paste(
  path: string,
  content: string,
  tier: "medium" | "large"
): ComposerAttachment {
  return {
    id: path,
    kind: "paste",
    name: "paste.txt",
    path,
    pasteContent: content,
    pasteTier: tier,
  };
}

function file(path: string): ComposerAttachment {
  return {
    id: path,
    kind: "file",
    name: path.split("/").pop() ?? path,
    path,
  };
}

describe("buildComposerSendText medium paste", () => {
  it("expands medium paste path in draft to full content", () => {
    const path = "/tmp/pier-terminal-pastes/paste-1.txt";
    const body = `please fix ${path}`;
    const payload = buildComposerSendText(
      [paste(path, "error stack here", "medium")],
      body
    );
    expect(payload).toBe("please fix error stack here");
    expect(payload).not.toContain(path);
  });

  it("does not inject medium content when path token missing and draft non-empty", () => {
    const path = "/tmp/pier-terminal-pastes/paste-2.txt";
    const payload = buildComposerSendText(
      [paste(path, "only content", "medium")],
      "hello"
    );
    expect(payload).toBe("hello");
  });

  it("sends medium contents when draft empty and only medium pastes", () => {
    const a = paste("/tmp/a.txt", "first", "medium");
    const b = paste("/tmp/b.txt", "second", "medium");
    expect(buildComposerSendText([a, b], "")).toBe("first\n\nsecond");
  });

  it("appends medium content when draft empty and other attachments need path prefix", () => {
    const med = paste(
      "/tmp/pier-terminal-pastes/m.txt",
      "medium body",
      "medium"
    );
    const img = file("/tmp/shot.png");
    const payload = buildComposerSendText([med, img], "");
    expect(payload).toBe("/tmp/shot.png\nmedium body");
  });

  it("appends medium content with large paste path when draft empty", () => {
    const med = paste(
      "/tmp/pier-terminal-pastes/m.txt",
      "medium body",
      "medium"
    );
    const large = paste(
      "/tmp/pier-terminal-pastes/L.txt",
      "large ignored",
      "large"
    );
    const payload = buildComposerSendText([med, large], "");
    expect(payload).toBe("/tmp/pier-terminal-pastes/L.txt\nmedium body");
  });

  it("expands medium path and prefixes other missing paths", () => {
    const medPath = "/tmp/pier-terminal-pastes/m.txt";
    const med = paste(medPath, "STACK", "medium");
    const img = file("/tmp/shot.png");
    const payload = buildComposerSendText([med, img], `see ${medPath}`);
    expect(payload).toBe("/tmp/shot.png\nsee STACK");
  });

  it("keeps large paste path semantics", () => {
    const path = "/tmp/pier-terminal-pastes/paste-large.txt";
    const draft = `see ${path}`;
    const payload = buildComposerSendText(
      [paste(path, "ignored for send expand", "large")],
      draft
    );
    expect(payload).toBe(draft);
  });

  it("prefixes large paste path when not in draft", () => {
    const path = "/tmp/pier-terminal-pastes/paste-large2.txt";
    const payload = buildComposerSendText(
      [paste(path, "body unused", "large")],
      "analyze"
    );
    expect(payload).toBe(`${path}\nanalyze`);
  });

  it("medium without pasteContent falls back to path semantics", () => {
    const path = "/tmp/pier-terminal-pastes/no-body.txt";
    const att: ComposerAttachment = {
      id: "x",
      kind: "paste",
      name: "paste.txt",
      path,
      pasteTier: "medium",
      // pasteContent missing
    };
    expect(buildComposerSendText([att], "hi")).toBe(`${path}\nhi`);
    expect(buildComposerSendText([att], path)).toBe(path);
  });

  it("expanded medium can exceed MAX_COMPOSER_SEND_TEXT_LENGTH (caller gates)", () => {
    const path = "/tmp/pier-terminal-pastes/huge.txt";
    const content = "z".repeat(MAX_COMPOSER_SEND_TEXT_LENGTH + 10);
    const payload = buildComposerSendText(
      [paste(path, content, "medium")],
      path
    );
    expect(payload.length).toBe(content.length);
    expect(payload.length).toBeGreaterThan(MAX_COMPOSER_SEND_TEXT_LENGTH);
  });
});
