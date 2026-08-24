import type { Text, Transaction } from "@codemirror/state";
import { type Extension, StateField } from "@codemirror/state";
import { showMinimap } from "@replit/codemirror-minimap";
import { gitGutterField } from "./git-gutter.ts";

/**
 * 源码编辑器右侧缩略图。
 * gutters 单轨镜像 SCM 行级变更（与左侧 git gutter 同一 field）；
 * 颜色已在 setGitGutterMarkers 边界解析为具体色值。
 *
 * minimap 库按「全量 parse + 全量高亮 + 整行 fillText」工作：大文档或超长单行
 * （node_modules 的 minified bundle、生成产物）会把主线程打满——缩略图画不出来，
 * 编辑器也滚不动。这里按文档规模门控：超限文档把 facet 置 null，库会在同一事务
 * 内 remove 掉 minimap DOM（卸载先于 parse，不会卡在半路）。
 */

/** 总量门槛：超过后全量 parse/高亮的同步成本不可接受。 */
const MAX_MINIMAP_DOC_LENGTH = 1_500_000;
/** 行数门槛：LinesState / updateMap 随行数线性增长。 */
const MAX_MINIMAP_LINES = 50_000;
/** 单行门槛：minified 单行会让 fillText 收到整段超长字符串。 */
const MAX_MINIMAP_LINE_LENGTH = 20_000;

function passesQuickGates(doc: Text): boolean {
  return doc.length <= MAX_MINIMAP_DOC_LENGTH && doc.lines <= MAX_MINIMAP_LINES;
}

/** O(doc.lines)：只在整文替换（打开/切换文件）时执行。 */
export function isMinimapEligibleDoc(doc: Text): boolean {
  if (!passesQuickGates(doc)) {
    return false;
  }
  for (let number = 1; number <= doc.lines; number += 1) {
    if (doc.line(number).length > MAX_MINIMAP_LINE_LENGTH) {
      return false;
    }
  }
  return true;
}

/** syncDocument 的全文替换：from 0 → to 旧全文长度。 */
function isWholeDocumentChange(tr: Transaction): boolean {
  const previousLength = tr.startState.doc.length;
  if (previousLength === 0) {
    return tr.docChanged;
  }
  let whole = false;
  tr.changes.iterChangedRanges((from, to) => {
    if (from === 0 && to === previousLength) {
      whole = true;
    }
  });
  return whole;
}

/** 增量编辑只检查被改动覆盖的行（其余行长度不变）。 */
function hasOversizedChangedLine(doc: Text, tr: Transaction): boolean {
  let oversized = false;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (oversized) {
      return;
    }
    const first = doc.lineAt(fromB).number;
    const last = doc.lineAt(Math.max(fromB, Math.min(toB, doc.length))).number;
    for (let number = first; number <= last; number += 1) {
      if (doc.line(number).length > MAX_MINIMAP_LINE_LENGTH) {
        oversized = true;
        return;
      }
    }
  });
  return oversized;
}

const minimapEligibilityField = StateField.define<boolean>({
  create: (state) => isMinimapEligibleDoc(state.doc),
  update: (value, tr) => {
    if (!tr.docChanged) {
      return value;
    }
    if (isWholeDocumentChange(tr)) {
      // 打开/切换文件：全量重估（重新启用也发生在这里）。
      return isMinimapEligibleDoc(tr.state.doc);
    }
    // 增量编辑：只做降级检查；缩回限额内要等下一次整文替换才恢复。
    return (
      value &&
      passesQuickGates(tr.state.doc) &&
      !hasOversizedChangedLine(tr.state.doc, tr)
    );
  },
  provide: (field) =>
    showMinimap.compute([field, gitGutterField], (state) =>
      state.field(field)
        ? {
            create: () => ({ dom: document.createElement("div") }),
            // VS Code default is character-like rendering; blocks is thicker and more intrusive.
            displayText: "characters" as const,
            gutters: [state.field(gitGutterField).minimapGutter],
            showOverlay: "always" as const,
          }
        : null
    ),
});

export function createMinimapExtension(): Extension {
  return minimapEligibilityField;
}
