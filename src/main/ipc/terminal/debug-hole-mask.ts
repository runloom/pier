import type { TerminalDebugHoleMaskSnapshot } from "@shared/contracts/terminal/debug.ts";
import type { TerminalFrame } from "@shared/contracts/terminal.ts";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function frameValue(value: unknown): TerminalFrame {
  const record = recordValue(value);
  return {
    height: numberValue(record?.height),
    width: numberValue(record?.width),
    x: numberValue(record?.x),
    y: numberValue(record?.y),
  };
}

/**
 * `TerminalHoleMask` 的 native debug payload（有洞时才有）。洞位是 contentView
 * top-left CSS px；数值校验与 surfaces 的 frame 同一套宽松规则。
 */
export function normalizeHoleMaskSnapshot(
  value: unknown
): TerminalDebugHoleMaskSnapshot | undefined {
  const record = recordValue(value);
  if (!record) {
    return;
  }
  const cutRects: TerminalFrame[] = [];
  if (Array.isArray(record.cutRects)) {
    for (const entry of record.cutRects) {
      if (recordValue(entry)) {
        cutRects.push(frameValue(entry));
      }
    }
  }
  const rawCount = record.cutRectCount;
  return {
    active: record.active === true,
    compositor: record.compositor === true,
    cutRectCount:
      typeof rawCount === "number" && Number.isFinite(rawCount)
        ? rawCount
        : cutRects.length,
    cutRects,
  };
}
