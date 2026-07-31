import { cn } from "@pier/ui/utils.ts";
import { useMemo } from "react";

interface DiffRow {
  kind: "added" | "context" | "removed";
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

function diffMarker(kind: DiffRow["kind"]): string {
  if (kind === "added") {
    return "+";
  }
  if (kind === "removed") {
    return "-";
  }
  return "";
}

const LCS_AREA_LIMIT = 4_000_000;

function stripCommonEdges(left: string[], right: string[]) {
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left.at(left.length - 1 - suffix) === right.at(right.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

/** 行级 LCS diff;超大输入退化为「整块替换」避免 O(n·m) 爆内存。 */
function diffLines(original: string, current: string): DiffRow[] {
  const left = original.split("\n");
  const right = current.split("\n");
  const { prefix, suffix } = stripCommonEdges(left, right);
  const leftMid = left.slice(prefix, left.length - suffix);
  const rightMid = right.slice(prefix, right.length - suffix);

  const rows: DiffRow[] = [];
  let leftNo = 1;
  let rightNo = 1;
  const pushContext = (text: string) => {
    rows.push({ kind: "context", leftNo, rightNo, text });
    leftNo += 1;
    rightNo += 1;
  };
  const pushRemoved = (text: string) => {
    rows.push({ kind: "removed", leftNo, rightNo: null, text });
    leftNo += 1;
  };
  const pushAdded = (text: string) => {
    rows.push({ kind: "added", leftNo: null, rightNo, text });
    rightNo += 1;
  };

  for (let index = 0; index < prefix; index += 1) {
    pushContext(left[index] ?? "");
  }

  if (leftMid.length * rightMid.length > LCS_AREA_LIMIT) {
    for (const line of leftMid) {
      pushRemoved(line);
    }
    for (const line of rightMid) {
      pushAdded(line);
    }
  } else if (leftMid.length > 0 || rightMid.length > 0) {
    const rows2 = leftMid.length + 1;
    const cols = rightMid.length + 1;
    const table = new Uint32Array(rows2 * cols);
    for (let i = leftMid.length - 1; i >= 0; i -= 1) {
      for (let j = rightMid.length - 1; j >= 0; j -= 1) {
        table[i * cols + j] =
          leftMid[i] === rightMid[j]
            ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
            : Math.max(
                table[(i + 1) * cols + j] ?? 0,
                table[i * cols + j + 1] ?? 0
              );
      }
    }
    let i = 0;
    let j = 0;
    while (i < leftMid.length && j < rightMid.length) {
      if (leftMid[i] === rightMid[j]) {
        pushContext(leftMid[i] ?? "");
        i += 1;
        j += 1;
      } else if (
        (table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)
      ) {
        pushRemoved(leftMid[i] ?? "");
        i += 1;
      } else {
        pushAdded(rightMid[j] ?? "");
        j += 1;
      }
    }
    while (i < leftMid.length) {
      pushRemoved(leftMid[i] ?? "");
      i += 1;
    }
    while (j < rightMid.length) {
      pushAdded(rightMid[j] ?? "");
      j += 1;
    }
  }

  for (let index = left.length - suffix; index < left.length; index += 1) {
    pushContext(left[index] ?? "");
  }

  return rows;
}

/**
 * 只读行级 diff 视图(磁盘版本 vs 当前缓冲)。保存冲突的 Compare 展示用,
 * 不承担编辑;左列磁盘行号、右列当前行号。
 */
export function FilesLineDiff({
  currentLabel,
  originalLabel,
  originalValue,
  value,
}: {
  currentLabel: string;
  originalLabel: string;
  originalValue: string;
  value: string;
}) {
  const rows = useMemo(
    () => diffLines(originalValue, value),
    [originalValue, value]
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto bg-background font-mono text-xs"
      data-slot="pier-files-line-diff"
    >
      <div className="sticky top-0 z-10 flex shrink-0 gap-4 border-border border-b bg-muted/60 px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
        <span className="text-destructive">- {originalLabel}</span>
        <span className="text-success">+ {currentLabel}</span>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={cn(
                row.kind === "added" && "bg-[var(--diff-addition-bg)]",
                row.kind === "removed" && "bg-[var(--diff-deletion-bg)]"
              )}
              // biome-ignore lint/suspicious/noArrayIndexKey: 行序即身份,列表只读且整体重建。
              key={index}
            >
              <td className="w-10 select-none border-border/40 border-r px-2 text-right text-muted-foreground">
                {row.leftNo ?? ""}
              </td>
              <td className="w-10 select-none border-border/40 border-r px-2 text-right text-muted-foreground">
                {row.rightNo ?? ""}
              </td>
              <td className="w-5 select-none text-center text-muted-foreground">
                {diffMarker(row.kind)}
              </td>
              <td className="whitespace-pre-wrap break-all px-2">{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
