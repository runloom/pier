import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(() => null),
  readImage: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getFocusedWindow: electronMocks.getFocusedWindow,
  },
  clipboard: { readImage: electronMocks.readImage },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
}));

import {
  isPierTerminalPastePath,
  MAX_COMPOSER_PASTE_CHARS,
  materializeTerminalComposerClipboardImage,
  materializeTerminalComposerImageBytes,
  materializeTerminalComposerTextBytes,
  pickTerminalComposerFiles,
  resolveTerminalComposerPaths,
  writeTerminalComposerPasteText,
} from "../../../../src/main/ipc/terminal/composer-attachments.ts";

const fixtures: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

afterEach(async () => {
  electronMocks.readImage.mockReset();
  electronMocks.showOpenDialog.mockReset();
  while (fixtures.length > 0) {
    const path = fixtures.pop();
    if (!path) continue;
    await rm(path, { force: true, recursive: true });
  }
});

describe("resolveTerminalComposerPaths", () => {
  it("returns readable files with path, name, and kind", async () => {
    const dir = await makeTempDir("pier-composer-resolve-");
    const imagePath = join(dir, "shot.PNG");
    const filePath = join(dir, "notes.pdf");
    await writeFile(imagePath, "img");
    await writeFile(filePath, "pdf");

    const result = await resolveTerminalComposerPaths([imagePath, filePath]);

    expect(result.failures).toEqual([]);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]).toMatchObject({
      kind: "image",
      name: "shot.PNG",
      path: imagePath,
    });
    expect(result.attachments[1]).toMatchObject({
      kind: "file",
      name: "notes.pdf",
      path: filePath,
    });
    expect(
      result.attachments.every((item) => typeof item.id === "string")
    ).toBe(true);
    expect(result.attachments[0]?.path).toBe(imagePath);
  });

  it("accepts directories as folder attachments", async () => {
    const dir = await makeTempDir("pier-composer-dir-");

    const result = await resolveTerminalComposerPaths([dir]);

    expect(result.attachments).toEqual([
      expect.objectContaining({
        isDirectory: true,
        kind: "file",
        name: expect.any(String),
        path: dir,
      }),
    ]);
    expect(result.failures).toEqual([]);
  });

  it("rejects missing paths", async () => {
    const missing = join(tmpdir(), `pier-composer-missing-${Date.now()}.bin`);

    const result = await resolveTerminalComposerPaths([missing]);

    expect(result.attachments).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.path).toBe(missing);
    expect(result.failures[0]?.reason.length).toBeGreaterThan(0);
  });

  it("keeps successful attachments when mixed with failures", async () => {
    const dir = await makeTempDir("pier-composer-mixed-");
    const okPath = join(dir, "ok.txt");
    await writeFile(okPath, "ok");
    const nestedDir = join(dir, "nested");
    await mkdir(nestedDir);
    const missing = join(dir, "gone.bin");

    const result = await resolveTerminalComposerPaths([
      okPath,
      nestedDir,
      missing,
    ]);

    expect(result.attachments).toEqual([
      expect.objectContaining({
        isDirectory: false,
        kind: "file",
        name: "ok.txt",
        path: okPath,
      }),
      expect.objectContaining({
        isDirectory: true,
        kind: "file",
        name: "nested",
        path: nestedDir,
      }),
    ]);
    expect(result.failures.map((item) => item.path).sort()).toEqual(
      [missing].sort()
    );
  });
});

describe("pickTerminalComposerFiles", () => {
  it("returns empty paths when the dialog is canceled", async () => {
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: ["/tmp/ignored.png"],
    });

    const result = await pickTerminalComposerFiles();

    expect(result).toEqual({ ok: true, paths: [] });
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.arrayContaining([
          "openFile",
          "openDirectory",
          "multiSelections",
        ]),
      })
    );
  });

  it("returns selected paths without copying", async () => {
    const dir = await makeTempDir("pier-composer-pick-");
    const first = join(dir, "a.pdf");
    const second = join(dir, "b.png");
    await writeFile(first, "a");
    await writeFile(second, "b");
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [first, second],
    });

    const result = await pickTerminalComposerFiles();

    expect(result).toEqual({ ok: true, paths: [first, second] });
  });
});

describe("materializeTerminalComposerClipboardImage", () => {
  it("returns null attachment when clipboard has no image", async () => {
    electronMocks.readImage.mockReturnValue({
      isEmpty: () => true,
      toPNG: () => Buffer.from("png"),
    });

    const result = await materializeTerminalComposerClipboardImage();

    expect(result).toEqual({ ok: true, attachment: null });
  });

  it("writes clipboard image bytes under pier-terminal-pastes", async () => {
    electronMocks.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from("png-bytes"),
    });

    const result = await materializeTerminalComposerClipboardImage();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment).not.toBeNull();
    const path = result.attachment?.path;
    expect(path).toContain("pier-terminal-pastes");
    expect(result.attachment).toMatchObject({
      kind: "image",
      name: expect.stringMatching(/\.png$/i),
    });
    if (path) {
      fixtures.push(path);
      expect(await readFile(path)).toEqual(Buffer.from("png-bytes"));
    }
  });
});

describe("materializeTerminalComposerImageBytes", () => {
  it("writes image bytes with mime-derived extension", async () => {
    const result = await materializeTerminalComposerImageBytes({
      bytes: [1, 2, 3, 4],
      mime: "image/webp",
      name: "clip.webp",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment).toMatchObject({
      kind: "image",
      name: "clip.webp",
      path: expect.stringContaining("pier-terminal-pastes"),
    });
    expect(result.attachment?.path.endsWith(".webp")).toBe(true);
    // On-disk name is unique — never the bare client basename (overwrite risk).
    expect(result.attachment?.path.endsWith("/clip.webp")).toBe(false);
    expect(result.attachment?.path).toMatch(/attachment-[0-9a-f-]+\.webp$/i);
    if (result.attachment?.path) {
      fixtures.push(result.attachment.path);
      expect(await readFile(result.attachment.path)).toEqual(
        Buffer.from([1, 2, 3, 4])
      );
    }
  });

  it("defaults extension to png when mime is unknown", async () => {
    const result = await materializeTerminalComposerImageBytes({
      bytes: [9, 8, 7],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment?.path.endsWith(".png")).toBe(true);
    expect(result.attachment?.kind).toBe("image");
    if (result.attachment?.path) fixtures.push(result.attachment.path);
  });

  it("does not reuse a fixed basename like image.png across pastes", async () => {
    const first = await materializeTerminalComposerImageBytes({
      bytes: [1, 1, 1],
      mime: "image/png",
      name: "image.png",
    });
    const second = await materializeTerminalComposerImageBytes({
      bytes: [2, 2, 2],
      mime: "image/png",
      name: "image.png",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(first.attachment?.name).toBe("image.png");
    expect(second.attachment?.name).toBe("image.png");
    expect(first.attachment?.path).not.toBe(second.attachment?.path);
    if (first.attachment?.path) fixtures.push(first.attachment.path);
    if (second.attachment?.path) fixtures.push(second.attachment.path);
    expect(await readFile(first.attachment?.path ?? "")).toEqual(
      Buffer.from([1, 1, 1])
    );
    expect(await readFile(second.attachment?.path ?? "")).toEqual(
      Buffer.from([2, 2, 2])
    );
  });
});

describe("materializeTerminalComposerTextBytes + writeTerminalComposerPasteText", () => {
  it("materializes paste kind and write overwrites existing file only", async () => {
    const result = await materializeTerminalComposerTextBytes({
      text: "original",
    });
    expect(result.ok).toBe(true);
    if (!(result.ok && result.attachment)) return;
    fixtures.push(result.attachment.path);
    expect(result.attachment.kind).toBe("paste");
    expect(isPierTerminalPastePath(result.attachment.path)).toBe(true);

    const written = await writeTerminalComposerPasteText({
      path: result.attachment.path,
      text: "updated",
    });
    expect(written).toEqual({ ok: true });
    expect(await readFile(result.attachment.path, "utf8")).toBe("updated");
  });

  it("rejects write outside paste directory", async () => {
    const outside = join(tmpdir(), `pier-not-pastes-${Date.now()}.txt`);
    await writeFile(outside, "x", "utf8");
    fixtures.push(outside);
    const result = await writeTerminalComposerPasteText({
      path: outside,
      text: "nope",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/outside paste directory/i);
  });

  it("rejects write when file does not exist", async () => {
    const missing = join(
      tmpdir(),
      "pier-terminal-pastes",
      `missing-${Date.now()}.txt`
    );
    // Ensure parent exists so path looks like a paste path, but file is gone.
    await mkdir(join(tmpdir(), "pier-terminal-pastes"), { recursive: true });
    expect(isPierTerminalPastePath(missing)).toBe(true);
    const result = await writeTerminalComposerPasteText({
      path: missing,
      text: "nope",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/i);
  });

  it("rejects oversize text on materialize", async () => {
    const result = await materializeTerminalComposerTextBytes({
      text: "x".repeat(MAX_COMPOSER_PASTE_CHARS + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("isPierTerminalPastePath rejects parent traversal", () => {
    const root = join(tmpdir(), "pier-terminal-pastes");
    expect(isPierTerminalPastePath(join(root, "ok.txt"))).toBe(true);
    expect(isPierTerminalPastePath(join(root, "..", "escape.txt"))).toBe(false);
    expect(isPierTerminalPastePath(root)).toBe(false);
  });
});
