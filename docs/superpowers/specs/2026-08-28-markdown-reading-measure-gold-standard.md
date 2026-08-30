# Markdown 预览阅读版心金标准

日期：2026-08-28  
状态：现行权威（files Markdown 预览舒适/宽屏阅读栏）  
范围：`[data-slot="markdown-prose"]` 的栏宽单位、折行、对齐，以及字号缩放与栏宽解耦。  
不包含：大纲细轨几何（见 AGENTS.md「Markdown 预览大纲布局复用」）；Canvas 组合壳 `max-w-5xl`（仪表盘/积木流，不是文章栏）；代码块开关（既有 `wordWrap` 偏好）。

## 一句话终态

舒适阅读是一条**物理栏宽**：根 `rem` 上的 `max-width`，不随正文字体、汉字/拉丁/等宽混排、或预览字号缩放而变。折满的行共用这条右缘；没折满的行右缘参差是左对齐正文的正确样子，不是第二套管宽。

## 产品栏

| 属性 | 终态 |
|---|---|
| 舒适 | `--md-measure: 42rem`（相对文档根，**禁止** `ch` / `em` / 正文字号派生） |
| 宽屏 | `--md-measure: 100%`（滚动内容盒，有大纲时仍避让细轨） |
| 窄面板 | `width: 100%` + `max-width`，实际栏宽 = `min(容器, 42rem)` |
| 水平位置 | `mx-auto` 居中 |
| 对齐 | `text-align: start`。**禁止** `justify`（含 HTML `align="justify"` / `text-justify`） |
| 长 token | `overflow-wrap: anywhere`（参与 min-content；禁止只用 `break-word`） |
| 列表/引用 | 只允许 **start** 侧缩进；内容右缘与段落共用版心盒右缘。正文列表 `text-wrap: wrap` |
| 字号 | `--md-scale` 只改 `--md-font-size`，**不得**改变 `--md-measure` |

`42rem` 在根字号 16px 时为 672px，贴近 Medium / iA Writer 一类阅读栏，也接近旧 `85ch` 在当时默认 13px 文档字体下的物理宽度（正文默认自 2026-08-30 起提至 15px，阅读缩放档位不变）；差别是栏宽不再绑在字符 `0` 的字形宽上。

## 不是缺陷

- 某一条 bullet 第一行在 `` `47000-47099` `` 后折行、下一条更长：同一 `max-width` 内的合法断点，不是栏宽不一致。
- 中英混排时「一行装下的字数」不同：物理右缘仍是同一条。
- 代码块关闭自动换行后内部横向滚动：块本身仍不超过版心。

## 禁止

1. 用 `ch` / 正文字体 `0` 宽 / `--md-scale` 派生舒适栏（缩放会把栏拉宽或拉窄）。
2. TS 再维护一套「渲染用 85ch」或按 CJK 字数估宽。`MARKDOWN_COMFORTABLE_MEASURE_REM` 只与 CSS 同值作治理锁定，禁止平行测宽 helper。
3. `text-align: justify` / `text-justify` / HTML `align="justify"`（行内代码会拉开字距；属性直接丢弃）。
4. 把 Canvas flow `max-w-5xl` 改成文章栏，或把文章栏改成 `max-w-5xl` 去「对齐」积木壳。
5. 为了让每条 bullet 一样长而改两端对齐或 `text-wrap: balance` 用于正文列表（含 callout 内列表）。

## 检查点

- `tests/unit/plugins/markdown/markdown-reading-measure-governance.test.ts`
- `tests/unit/plugins/markdown/markdown-prose-css.test.ts`
- `tests/unit/plugins/markdown/markdown-preview-layout-governance.test.ts`
- `tests/unit/plugins/markdown/markdown-preview-toc-layout.test.ts`
