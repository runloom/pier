import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { kindFromFileName } from "@shared/composer-attachment-kind.ts";
import type {
  TerminalComposerAttachmentDto,
  TerminalComposerImageBytes,
  TerminalComposerMaterializeResult,
  TerminalComposerPathsResult,
  TerminalComposerPickResult,
} from "@shared/contracts/terminal.ts";
import {
  BrowserWindow,
  clipboard,
  dialog,
  type BrowserWindow as ElectronBrowserWindow,
  nativeImage,
  shell,
} from "electron";

const PASTE_RETENTION_MS = 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS_BY_MIME: Readonly<Record<string, string>> = {
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachmentDto(
  path: string,
  name = basename(path),
  previewDataUrl?: string
): TerminalComposerAttachmentDto {
  return {
    id: crypto.randomUUID(),
    kind: kindFromFileName(name),
    name,
    path,
    ...(previewDataUrl ? { previewDataUrl } : {}),
  };
}

/** Build a small JPEG/PNG data URL for image chips; failures return undefined. */
function previewDataUrlForImagePath(filePath: string): string | undefined {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      return;
    }
    const size = image.getSize();
    const maxEdge = 128;
    const scale = Math.min(1, maxEdge / Math.max(size.width, size.height, 1));
    const resized =
      scale < 1
        ? image.resize({
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "better",
            width: Math.max(1, Math.round(size.width * scale)),
          })
        : image;
    const png = resized.toPNG();
    if (png.byteLength === 0 || png.byteLength > 250_000) {
      // Oversized preview: skip rather than push large base64 into renderer.
      return;
    }
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return;
  }
}

function attachmentDtoFromPath(
  filePath: string,
  isDirectory = false
): TerminalComposerAttachmentDto {
  const name = basename(filePath);
  const kind = isDirectory ? "file" : kindFromFileName(name);
  const preview =
    !isDirectory && kind === "image"
      ? previewDataUrlForImagePath(filePath)
      : undefined;
  return { ...attachmentDto(filePath, name, preview), isDirectory };
}

async function preparePasteDirectory(): Promise<string> {
  const directory = join(tmpdir(), "pier-terminal-pastes");
  await mkdir(directory, { recursive: true });
  const cutoff = Date.now() - PASTE_RETENTION_MS;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
    } catch {
      // Best-effort cleanup must not block a new attachment.
    }
  }
  return directory;
}

function extensionForMime(mime: string | undefined): string {
  if (!mime) return "png";
  return IMAGE_EXTENSIONS_BY_MIME[mime.toLowerCase()] ?? "png";
}

export async function resolveTerminalComposerPaths(
  paths: readonly string[]
): Promise<TerminalComposerPathsResult> {
  const attachments: TerminalComposerAttachmentDto[] = [];
  const failures: TerminalComposerPathsResult["failures"] = [];

  for (const path of paths) {
    if (typeof path !== "string" || path.trim() === "") {
      failures.push({ path: String(path ?? ""), reason: "invalid path" });
      continue;
    }
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        attachments.push(attachmentDtoFromPath(path, true));
      } else if (info.isFile()) {
        attachments.push(attachmentDtoFromPath(path));
      } else {
        failures.push({ path, reason: "not a file or directory" });
      }
    } catch (error) {
      failures.push({ path, reason: errorMessage(error) });
    }
  }

  return { attachments, failures };
}

export async function pickTerminalComposerFiles(input?: {
  parentWindow?: ElectronBrowserWindow | null;
}): Promise<TerminalComposerPickResult> {
  try {
    const options = {
      filters: [{ extensions: ["*"], name: "All Files" }],
      properties: ["openFile", "openDirectory", "multiSelections"] as Array<
        "openFile" | "openDirectory" | "multiSelections"
      >,
    };
    const parent =
      input?.parentWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return { ok: true, paths: [] };
    return { ok: true, paths: result.filePaths };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function materializeTerminalComposerClipboardImage(): Promise<TerminalComposerMaterializeResult> {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { ok: true, attachment: null };
    }
    const directory = await preparePasteDirectory();
    const name = `clipboard-${crypto.randomUUID()}.png`;
    const path = join(directory, name);
    await writeFile(path, image.toPNG());
    return { ok: true, attachment: attachmentDtoFromPath(path) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function materializeTerminalComposerImageBytes(
  data: TerminalComposerImageBytes
): Promise<TerminalComposerMaterializeResult> {
  try {
    const rawBytes = data?.bytes;
    const bytesOk =
      (rawBytes instanceof Uint8Array && rawBytes.byteLength > 0) ||
      (Array.isArray(rawBytes) && rawBytes.length > 0);
    if (!bytesOk) {
      return { ok: false, error: "invalid image bytes" };
    }
    const extension = extensionForMime(data.mime);
    const directory = await preparePasteDirectory();
    const name =
      typeof data.name === "string" && data.name.trim() !== ""
        ? basename(data.name)
        : `attachment-${crypto.randomUUID()}.${extension}`;
    const path = join(
      directory,
      name.includes(".") ? name : `${name}.${extension}`
    );
    const raw =
      rawBytes instanceof Uint8Array
        ? rawBytes
        : Uint8Array.from(rawBytes as number[]);
    await writeFile(path, Buffer.from(raw));
    return {
      ok: true,
      attachment: attachmentDtoFromPath(path),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function materializeTerminalComposerTextBytes(data: {
  name?: string | undefined;
  text: string;
}): Promise<TerminalComposerMaterializeResult> {
  try {
    const text = typeof data?.text === "string" ? data.text : "";
    if (text.length === 0) {
      return { ok: false, error: "empty text" };
    }
    // Soft ceiling well above the 10k auto-attach threshold and the 64k
    // sendText limit — blocks pathological clipboard dumps from filling disk.
    const MAX_PASTE_CHARS = 2_000_000;
    if (text.length > MAX_PASTE_CHARS) {
      return {
        ok: false,
        error: `paste too large (${text.length} chars; max ${MAX_PASTE_CHARS})`,
      };
    }
    const directory = await preparePasteDirectory();
    const name =
      typeof data.name === "string" && data.name.trim() !== ""
        ? basename(data.name)
        : `paste-${crypto.randomUUID()}.txt`;
    const path = join(directory, name.includes(".") ? name : `${name}.txt`);
    await writeFile(path, text, "utf8");
    return { ok: true, attachment: attachmentDtoFromPath(path) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function revealTerminalComposerPath(path: string): Promise<void> {
  shell.showItemInFolder(path);
}
