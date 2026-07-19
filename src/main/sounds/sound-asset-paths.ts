import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ATTENTION_BUILTIN_SOUND_IDS,
  attentionSoundFileName,
} from "@shared/attention-sound-catalog.ts";
import { isDevRuntime } from "../runtime-mode.ts";

const ALLOWED_SOUND_FILES = new Set(
  ATTENTION_BUILTIN_SOUND_IDS.map((id) => attentionSoundFileName(id))
);

/**
 * 内置提示音的物理根目录。
 *
 * 独立于 fonts 的 assetRootDir()：fonts helper 恒指向 fonts/，
 * 音效复用会 404。用 isDevRuntime() 判 dev/prod（PierDev.app 下
 * app.isPackaged 为 true，裸用会指错路径）。
 *
 * - dev：cwd/resources/notification-sounds
 * - prod：process.resourcesPath/notification-sounds（extraResources）
 */
export function soundAssetRootDir(): string {
  if (isDevRuntime()) {
    const devRoot = join(process.cwd(), "resources/notification-sounds");
    if (!existsSync(devRoot)) {
      console.warn(
        `[sounds] resources/notification-sounds 不存在 (cwd=${process.cwd()}), 提示音可能加载失败 — 确认从 worktree 根启动`
      );
    }
    return devRoot;
  }
  return join(process.resourcesPath, "notification-sounds");
}

/**
 * 将 catalog 白名单内的 basename 解析为绝对路径；非法名 / 路径穿越返回 null。
 */
export function resolveBundledSoundAbsolutePath(
  fileName: string
): string | null {
  if (fileName !== basename(fileName) || !ALLOWED_SOUND_FILES.has(fileName)) {
    return null;
  }
  return join(soundAssetRootDir(), fileName);
}
