/**
 * SVG 固有尺寸解析。
 *
 * 只实现浏览器 `<img>` 真正遵守的那一小撮规则：宽度求值的复杂度很高
 * （容器 300×150、viewport 缺省、百分比、单位换算），所以这里只做
 * 确定性的部分，拿不准就返回 null，让调用方按「尺寸未知」处理。
 *
 * 这里的取值只用于展示（舞台尺寸、宽高比、`1200×700` 说明），
 * 不参与任何布局计算之外的判断，因此允许比浏览器保守。
 */
export interface PreviewSvgSize {
  readonly height: number;
  readonly width: number;
}

/** CSS 绝对长度单位 → px（96dpi）。百分比 / em 等相对单位不在此表。 */
const SVG_ABSOLUTE_UNIT_PX: Readonly<Record<string, number>> = {
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
  px: 1,
  q: 96 / 101.6,
};

/** `<number>`（含 `.5` / `1e3`），换算成 px；相对单位返回 null。 */
export function parseSvgLengthPx(value: string): number | null {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/u.exec(
      value
    );
  if (match === null) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const factor = unit === "" ? 1 : SVG_ABSOLUTE_UNIT_PX[unit];
  if (factor === undefined || !Number.isFinite(amount)) {
    return null;
  }
  const pixels = amount * factor;
  return pixels > 0 ? pixels : null;
}

/**
 * 从根 `<svg>` 开标签求固有尺寸。
 *
 * 与 Chromium `<img>` 对齐的行为：
 * - `width` / `height` 先于 `viewBox`，两者都有时直接用。
 * - 只给一侧时，用 `viewBox` 的宽高比补另一侧；没有 `viewBox` 时按默认
 *   视口 300×150 补（Chromium 同样如此）。
 * - 属性名大小写敏感：`WIDTH` / `viewbox` 浏览器不认，这里也不认。
 * - `data-*` 等其它属性里出现的 `width="..."` 不算数（配对引号内不解析）。
 *
 * 唯一有意偏离 Chromium 的地方：**只有 `viewBox`** 时返回 viewBox 的
 * 固有尺寸，而不是浏览器把图片塞进 300×150 后得到的缩放值。Chromium
 * 会把 1200×700 的 viewBox 报成 257×150；对 diff 而言那是「被容器压小」
 * 的结果，用 viewBox 本身才得到正确的宽高比与说明文字。
 */
export function parseSvgSizeFromRootTag(tag: string): PreviewSvgSize | null {
  const viewBox = parseViewBox(attributeValue(tag, "viewBox"));
  const explicitWidth = lengthAttribute(tag, "width");
  const explicitHeight = lengthAttribute(tag, "height");
  if (explicitWidth !== null && explicitHeight !== null) {
    return roundSize(explicitWidth, explicitHeight);
  }
  if (viewBox === null) {
    if (explicitWidth === null && explicitHeight === null) {
      return null;
    }
    // Chromium：缺失轴直接取默认视口对应轴（不是按比例）。
    return explicitWidth === null
      ? roundSize(DEFAULT_SVG_VIEWPORT.width, explicitHeight ?? 0)
      : roundSize(explicitWidth, DEFAULT_SVG_VIEWPORT.height);
  }
  if (explicitWidth !== null) {
    return roundSize(
      explicitWidth,
      viewBox.height * (explicitWidth / viewBox.width)
    );
  }
  if (explicitHeight !== null) {
    return roundSize(
      viewBox.width * (explicitHeight / viewBox.height),
      explicitHeight
    );
  }
  return roundSize(viewBox.width, viewBox.height);
}

/** 浏览器 <img> 的默认视口，用于单边尺寸推导。 */
const DEFAULT_SVG_VIEWPORT: PreviewSvgSize = { height: 150, width: 300 };

function roundSize(width: number, height: number): PreviewSvgSize | null {
  if (!(width > 0 && height > 0)) {
    return null;
  }
  return {
    height: Math.max(1, Math.round(height)),
    width: Math.max(1, Math.round(width)),
  };
}

function lengthAttribute(tag: string, name: string): number | null {
  const raw = attributeValue(tag, name);
  return raw === null ? null : parseSvgLengthPx(raw);
}

function parseViewBox(value: string | null): PreviewSvgSize | null {
  if (value === null) {
    return null;
  }
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const width = parts[2] ?? 0;
  const height = parts[3] ?? 0;
  return width > 0 && height > 0 ? { height, width } : null;
}

/**
 * 精确匹配属性名（大小写敏感），并在扫描时跳过其它属性的引号值。
 * 只处理带引号的写法：浏览器同样不接受 `<svg width=320>`。
 */
function attributeValue(tag: string, name: string): string | null {
  let index = tag.startsWith("<svg") ? 4 : 0;
  while (index < tag.length) {
    // 先跳到下一个属性名起点；标签名与属性之间的空白在这里消费掉。
    while (index < tag.length && /[\s/]/u.test(tag[index] ?? "")) {
      index += 1;
    }
    if (index >= tag.length || tag[index] === ">") {
      return null;
    }
    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/u.test(tag[index] ?? "")) {
      index += 1;
    }
    const attrName = tag.slice(nameStart, index);
    while (index < tag.length && /\s/u.test(tag[index] ?? "")) {
      index += 1;
    }
    if (tag[index] !== "=") {
      // 没有值的属性（SVG 里不合法，浏览器会忽略），继续找下一个。
      continue;
    }
    index += 1;
    while (index < tag.length && /\s/u.test(tag[index] ?? "")) {
      index += 1;
    }
    const quote = tag[index];
    if (quote !== '"' && quote !== "'") {
      // 未加引号的值：浏览器同样不认，整个根标签放弃。
      return null;
    }
    const end = tag.indexOf(quote, index + 1);
    if (end < 0) {
      return null;
    }
    if (attrName === name) {
      return tag.slice(index + 1, end);
    }
    index = end + 1;
  }
  return null;
}
