import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// 语法高亮 palette。与 Pier 的语义色系统对齐 —— 直接引用 :root 上的 CSS 变量,
// 主题(light/dark)切换或 style preset 切换时无需重建 HighlightStyle,浏览器
// 自动跟随。避免拷贝 Cursor Light+/Dark+ 一整套硬编码 palette。
//
// 语义分工:
//   --foreground        —— 变量、属性、标点、纯文本
//   --muted-foreground  —— 注释 (italic)
//   --info              —— 函数、数字、常量、attribute (蓝)
//   --success           —— 字符串 (绿)
//   --warning           —— 类型、类、命名空间、tag、regex/escape (橙)
//   --done              —— 关键字、控制流、storage (紫)
//   --destructive       —— 语法错误、非法字符
export const filesSyntaxHighlightStyle = HighlightStyle.define([
  // Comments —— muted, italic (对齐 Cursor 参考图里的 gray-italic 注释)
  {
    tag: [t.lineComment, t.blockComment, t.docComment, t.comment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  // Strings + characters + attribute values —— success (green)
  {
    tag: [t.string, t.docString, t.character, t.attributeValue],
    color: "var(--success)",
  },
  {
    tag: [t.regexp, t.escape],
    color: "var(--warning)",
  },
  // Numeric + boolean + null + atom —— info (blue)
  {
    tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit],
    color: "var(--info)",
  },
  // Keywords + control flow + storage —— done (purple)
  {
    tag: [
      t.keyword,
      t.self,
      t.definitionKeyword,
      t.moduleKeyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.modifier,
    ],
    color: "var(--done)",
  },
  // Operators + punctuation
  {
    tag: [
      t.operator,
      t.arithmeticOperator,
      t.logicOperator,
      t.bitwiseOperator,
      t.compareOperator,
      t.updateOperator,
      t.controlOperator,
      t.typeOperator,
      t.derefOperator,
      t.definitionOperator,
    ],
    color: "var(--foreground)",
  },
  {
    tag: [t.punctuation, t.separator],
    color: "var(--muted-foreground)",
  },
  {
    tag: [t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket],
    color: "var(--muted-foreground)",
  },
  // Names —— variables + properties inherit --foreground
  {
    tag: [t.variableName, t.propertyName, t.labelName],
    color: "var(--foreground)",
  },
  // Function names + support functions —— info
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.function(t.propertyName),
      t.function(t.definition(t.propertyName)),
      t.standard(t.variableName),
    ],
    color: "var(--info)",
  },
  // Constants + enum members —— info
  {
    tag: [t.constant(t.variableName), t.constant(t.name)],
    color: "var(--info)",
  },
  // Types + classes + namespaces + tags —— warning (orange)
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName, t.macroName],
    color: "var(--warning)",
  },
  {
    tag: t.attributeName,
    color: "var(--info)",
  },
  // Meta / annotations / preprocessor
  {
    tag: [t.meta, t.annotation, t.documentMeta, t.processingInstruction],
    color: "var(--muted-foreground)",
  },
  // Markdown prose
  {
    tag: [
      t.heading,
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
    ],
    color: "var(--done)",
    fontWeight: "600",
  },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  {
    tag: [t.link, t.url],
    color: "var(--info)",
    textDecoration: "underline",
  },
  {
    tag: [t.monospace],
    color: "var(--success)",
  },
  {
    tag: t.strikethrough,
    textDecoration: "line-through",
  },
  {
    tag: [t.list, t.quote, t.content, t.contentSeparator],
    color: "var(--foreground)",
  },
  // Diff / change tracking
  {
    tag: t.inserted,
    color: "var(--success)",
  },
  {
    tag: t.deleted,
    color: "var(--destructive)",
  },
  {
    tag: t.changed,
    color: "var(--warning)",
  },
  // Invalid tokens
  {
    tag: t.invalid,
    color: "var(--destructive)",
    textDecoration: "underline wavy",
  },
]);
