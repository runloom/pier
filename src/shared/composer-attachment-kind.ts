const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/**
 * Extensions that must not be sniffed as text for composer rail previews.
 * Unknown / extensionless names may still be attempted and rejected on NUL.
 */
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|heic|avif|raw|ico|psd|ai|sketch|zip|tar|gz|tgz|bz2?|xz|7z|rar|cab|iso|dmg|jar|war|pak|whl|egg|mp[34]|wav|flac|aac|ogg|opus|m4a|amr|wma|aiff?|dsf|alac|mp4|mov|avi|mkv|webm|flv|wmv|mpeg|mpg|m4v|3gp|vob|ogv|pdf|epub|pages|key|numbers|docx?|xlsx?|pptx?|odt|ods|odp|wasm|exe|dll|so|dylib|class|o|a|lib|bin|dat|woff2?|ttf|otf|eot|icns|sqlite3?|db)$/i;

export const COMPOSER_TEXT_PREVIEW_MAX_CHARS = 400;
export const COMPOSER_TEXT_PREVIEW_MAX_LINES = 2;
export const COMPOSER_TEXT_PREVIEW_READ_BYTES = 4096;

export function kindFromFileName(name: string): "image" | "file" {
  return IMAGE_EXT.test(name) ? "image" : "file";
}

export function shouldAttemptComposerTextPreview(input: {
  isDirectory?: boolean;
  name: string;
}): boolean {
  if (input.isDirectory) {
    return false;
  }
  if (kindFromFileName(input.name) === "image") {
    return false;
  }
  return !BINARY_EXT.test(input.name);
}

/** True when the sample is unsafe to decode as a text thumbnail. */
export function looksLikeComposerBinaryPreviewBytes(
  bytes: Uint8Array
): boolean {
  for (const octet of bytes) {
    if (octet === 0) {
      return true;
    }
  }
  return false;
}

/**
 * First few lines of a composer text thumbnail.
 * Walks the string so a multi-megabyte paste does not allocate a line array.
 */
export function clipComposerTextPreview(text: string): string {
  const kept: string[] = [];
  let chars = 0;
  let started = false;
  let index = 0;
  const length = text.length;

  while (
    index < length &&
    kept.length < COMPOSER_TEXT_PREVIEW_MAX_LINES &&
    chars < COMPOSER_TEXT_PREVIEW_MAX_CHARS
  ) {
    let end = index;
    while (end < length) {
      const code = text.charCodeAt(end);
      if (code === 10 || code === 13) {
        break;
      }
      end += 1;
    }
    const line = text.slice(index, end);
    if (end < length) {
      if (text.charCodeAt(end) === 13) {
        end += 1;
      }
      if (end < length && text.charCodeAt(end) === 10) {
        end += 1;
      }
    }

    if (!started) {
      if (line.trim() === "") {
        index = end;
        continue;
      }
      started = true;
    }

    const room = COMPOSER_TEXT_PREVIEW_MAX_CHARS - chars;
    const slice = line.length > room ? line.slice(0, room) : line;
    kept.push(slice);
    chars += slice.length + 1;
    index = end;
  }

  if (!started) {
    return "";
  }
  return kept.join("\n").trimEnd();
}
