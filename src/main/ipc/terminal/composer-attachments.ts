import {
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  COMPOSER_TEXT_PREVIEW_READ_BYTES,
  clipComposerTextPreview,
  kindFromFileName,
  looksLikeComposerBinaryPreviewBytes,
  shouldAttemptComposerTextPreview,
} from "@shared/composer-attachment-kind.ts";
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
/** Soft ceiling well above 10k auto-attach and 64k sendText — disk dump guard. */
export const MAX_COMPOSER_PASTE_CHARS = 2_000_000;
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

function attachmentDto(input: {
  isDirectory?: boolean;
  kindOverride?: TerminalComposerAttachmentDto["kind"];
  name?: string;
  path: string;
  previewDataUrl?: string;
  previewHeight?: number;
  previewWidth?: number;
  textPreview?: string;
}): TerminalComposerAttachmentDto {
  const name = input.name ?? basename(input.path);
  return {
    id: crypto.randomUUID(),
    kind: input.kindOverride ?? kindFromFileName(name),
    name,
    path: input.path,
    ...(input.isDirectory === undefined
      ? {}
      : { isDirectory: input.isDirectory }),
    ...(input.previewDataUrl ? { previewDataUrl: input.previewDataUrl } : {}),
    ...(input.previewWidth ? { previewWidth: input.previewWidth } : {}),
    ...(input.previewHeight ? { previewHeight: input.previewHeight } : {}),
    ...(input.textPreview ? { textPreview: input.textPreview } : {}),
  };
}

function pasteDirectoryPath(): string {
  return join(tmpdir(), "pier-terminal-pastes");
}

/** True when `filePath` is a file inside the managed pier-terminal-pastes directory. */
export function isPierTerminalPastePath(filePath: string): boolean {
  const root = resolve(pasteDirectoryPath());
  const target = resolve(filePath);
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const IMAGE_PREVIEW_MAX_EDGE_PX = 320;
const IMAGE_PREVIEW_MAX_BYTES = 250_000;

interface ImageRailPreview {
  previewDataUrl: string;
  previewHeight: number;
  previewWidth: number;
}

/** Build a small PNG data URL for image chips; failures return undefined. */
function imagePreviewForPath(filePath: string): ImageRailPreview | undefined {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      return;
    }
    const size = image.getSize();
    if (size.width < 1 || size.height < 1) {
      return;
    }
    const scale = Math.min(
      1,
      IMAGE_PREVIEW_MAX_EDGE_PX / Math.max(size.width, size.height)
    );
    const resized =
      scale < 1
        ? image.resize({
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "better",
            width: Math.max(1, Math.round(size.width * scale)),
          })
        : image;
    const png = resized.toPNG();
    if (png.byteLength === 0 || png.byteLength > IMAGE_PREVIEW_MAX_BYTES) {
      // Oversized preview: skip rather than push large base64 into renderer.
      return;
    }
    return {
      previewDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      previewHeight: size.height,
      previewWidth: size.width,
    };
  } catch {
    return;
  }
}

async function textPreviewForPath(
  filePath: string,
  name: string,
  isDirectory: boolean
): Promise<string | undefined> {
  if (!shouldAttemptComposerTextPreview({ isDirectory, name })) {
    return;
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(COMPOSER_TEXT_PREVIEW_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead === 0) {
      return;
    }
    const sample = buffer.subarray(0, bytesRead);
    if (looksLikeComposerBinaryPreviewBytes(sample)) {
      return;
    }
    const clipped = clipComposerTextPreview(sample.toString("utf8"));
    return clipped.length > 0 ? clipped : undefined;
  } catch {
    return;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function attachmentDtoFromPath(
  filePath: string,
  isDirectory = false
): Promise<TerminalComposerAttachmentDto> {
  const name = basename(filePath);
  const kind = isDirectory ? "file" : kindFromFileName(name);
  const imagePreview =
    !isDirectory && kind === "image"
      ? imagePreviewForPath(filePath)
      : undefined;
  const textPreview =
    !isDirectory && kind !== "image"
      ? await textPreviewForPath(filePath, name, isDirectory)
      : undefined;
  return attachmentDto({
    isDirectory,
    name,
    path: filePath,
    ...(imagePreview ?? {}),
    ...(textPreview ? { textPreview } : {}),
  });
}

async function preparePasteDirectory(): Promise<string> {
  const directory = pasteDirectoryPath();
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
        attachments.push(await attachmentDtoFromPath(path, true));
      } else if (info.isFile()) {
        attachments.push(await attachmentDtoFromPath(path));
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
    return { ok: true, attachment: await attachmentDtoFromPath(path) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Paste materializations always use a unique on-disk name under
 * pier-terminal-pastes. Reusing the client basename (e.g. image.png) would
 * overwrite the previous file and collide with path-based rail dedupe, so the
 * second paste looks "stuck" or shows a stale preview/status.
 */
function uniquePasteFileName(extension: string): string {
  const ext = extension.replace(/^\./, "") || "bin";
  return `attachment-${crypto.randomUUID()}.${ext}`;
}

function displayNameForPaste(
  requested: string | undefined,
  fallback: string
): string {
  if (typeof requested === "string" && requested.trim() !== "") {
    return basename(requested);
  }
  return fallback;
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
    const displayName = displayNameForPaste(
      data.name,
      `attachment.${extension}`
    );
    const path = join(directory, uniquePasteFileName(extension));
    const raw =
      rawBytes instanceof Uint8Array
        ? rawBytes
        : Uint8Array.from(rawBytes as number[]);
    await writeFile(path, Buffer.from(raw));
    const preview = imagePreviewForPath(path);
    return {
      ok: true,
      attachment: attachmentDto({
        name: displayName,
        path,
        ...(preview ?? {}),
      }),
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
    if (text.length > MAX_COMPOSER_PASTE_CHARS) {
      return {
        ok: false,
        error: `paste too large (${text.length} chars; max ${MAX_COMPOSER_PASTE_CHARS})`,
      };
    }
    const directory = await preparePasteDirectory();
    const displayName = displayNameForPaste(data.name, "paste.txt");
    const path = join(directory, uniquePasteFileName("txt"));
    await writeFile(path, text, "utf8");
    const name = displayName.includes(".") ? displayName : `${displayName}.txt`;
    const textPreview = clipComposerTextPreview(text);
    return {
      ok: true,
      attachment: attachmentDto({
        kindOverride: "paste",
        name,
        path,
        ...(textPreview.length > 0 ? { textPreview } : {}),
      }),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Overwrite an existing paste file under pier-terminal-pastes.
 * Rejects paths outside the directory, missing files, non-files, and
 * realpath targets that escape the paste root (symlink defense).
 *
 * Note: macOS often has `$TMPDIR` under `/var` → `/private/var`; always compare
 * realpath(pasteRoot) vs realpath(target), not raw resolve() strings alone.
 */
export async function writeTerminalComposerPasteText(data: {
  path: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const filePath = typeof data?.path === "string" ? data.path : "";
    const text = typeof data?.text === "string" ? data.text : "";
    if (filePath.length === 0) {
      return { ok: false, error: "invalid path" };
    }
    // Cheap string-level reject before fs (still pass materialize paths that
    // only differ after realpath via /var vs /private/var).
    if (!isPierTerminalPastePath(filePath)) {
      return { ok: false, error: "path outside paste directory" };
    }
    if (text.length > MAX_COMPOSER_PASTE_CHARS) {
      return {
        ok: false,
        error: `paste too large (${text.length} chars; max ${MAX_COMPOSER_PASTE_CHARS})`,
      };
    }

    const pasteRootCandidate = pasteDirectoryPath();
    await mkdir(pasteRootCandidate, { recursive: true });
    let pasteRoot: string;
    try {
      pasteRoot = await realpath(pasteRootCandidate);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    let realTarget: string;
    try {
      realTarget = await realpath(filePath);
    } catch {
      return { ok: false, error: "paste file not found" };
    }
    const rel = relative(pasteRoot, realTarget);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      return { ok: false, error: "path outside paste directory" };
    }
    const info = await stat(realTarget);
    if (!info.isFile()) {
      return { ok: false, error: "not a file" };
    }

    await writeFile(realTarget, text, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function revealTerminalComposerPath(path: string): Promise<void> {
  shell.showItemInFolder(path);
}
