import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
} from "@pierre/trees";
import { type CSSProperties, type SVGProps, useLayoutEffect } from "react";
import { PIER_FILE_ICON_COLOR_BY_TOKEN } from "./file-icon-theme.ts";
import { cn } from "./utils.ts";

const FILE_ICON_PREFIX = "pier.file:";
const FILE_ICON_SET = "complete" as const;
const fileIconResolver = createFileTreeIconResolver(FILE_ICON_SET);
const fileIconSpriteSheet = getBuiltInSpriteSheet(FILE_ICON_SET);

function ensureFileIconSpriteSheet(): void {
  if (document.querySelector('[data-pier-file-icon-sprite="true"]')) {
    return;
  }
  // 内容由固定版本的 @pierre/trees 生成；用浏览器 HTML/SVG 解析器保留其中
  // 兼容 HTML 的属性形式（严格 XML 解析会把它们误判为 parsererror）。
  const fragment = document
    .createRange()
    .createContextualFragment(fileIconSpriteSheet);
  const sprite = fragment.querySelector("svg");
  if (!sprite) {
    return;
  }
  sprite.setAttribute("data-pier-file-icon-sprite", "true");
  document.body.append(sprite);
}

function basename(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).filter(Boolean).at(-1) ?? pathOrName;
}

export function fileTabIconId(pathOrName: string): string {
  return `${FILE_ICON_PREFIX}${encodeURIComponent(basename(pathOrName))}`;
}

export function fileNameFromTabIconId(
  iconId: string | undefined
): string | null {
  if (!iconId?.startsWith(FILE_ICON_PREFIX)) {
    return null;
  }
  try {
    const name = decodeURIComponent(iconId.slice(FILE_ICON_PREFIX.length));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

interface PierFileIconProps
  extends Omit<
    SVGProps<SVGSVGElement>,
    "children" | "height" | "style" | "viewBox" | "width"
  > {
  fileName: string;
  size?: number;
}

export function PierFileIcon({
  className,
  fileName,
  size = 16,
  ...props
}: PierFileIconProps) {
  useLayoutEffect(ensureFileIconSpriteSheet, []);
  const icon = fileIconResolver.resolveIcon("file-tree-icon-file", fileName);
  const token = icon.token ?? "default";
  const color =
    PIER_FILE_ICON_COLOR_BY_TOKEN[token] ??
    PIER_FILE_ICON_COLOR_BY_TOKEN.default;
  const style = { color } satisfies CSSProperties;
  const symbolId = icon.name.replace(/^#/, "");
  const viewBox =
    icon.viewBox ?? `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`;

  return (
    <svg
      {...props}
      className={cn("pier-file-icon", className)}
      data-icon-name={icon.remappedFrom ?? icon.name}
      data-icon-token={token}
      data-pier-file-icon={fileName}
      height={size}
      style={style}
      viewBox={viewBox}
      width={size}
    >
      <title>{fileName}</title>
      <use href={`#${symbolId}`} />
    </svg>
  );
}
