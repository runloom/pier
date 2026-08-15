# 增强输入芯片与正文对齐

日期：2026-08-15  
状态：已落地  
范围：增强输入 Lexical 装饰芯片与相邻正文的**垂直对齐**。不改发送序列化、原子选区、自动完成。

相关：

- 编辑器母约：[`2026-07-22-rich-input-structured-composer-design.md`](./2026-07-22-rich-input-structured-composer-design.md)
- 治理检查：`tests/unit/renderer/terminal/structured-composer/composer-chip-align-governance.test.ts`

## 1. 问题

附件芯片（回形针 + 序号）和旁边打出来的字不在同一条线上。根因不是漏写 `align-items`，而是把 B 族原子装饰节点做成了「行高等高的中点盒」：

- 宿主 `height: 1.25rem` + `vertical-align: middle`（中点对到基线 + ½ x-height）
- 药丸 `h-5` + `text-[0.85em]`，序号在 20px 盒里垂直居中

`middle` 让 20px 盒子比没有下行的数字更往下探，行盒被撑开，正文留在字母基线上。里面缩小一号的序号即使外框居中也共不了基线。

`1.25rem` 高度是 2026-07-22 为了「和光标共用行盒」加上的。紧凑模式光标被拉成 `h-9` 是另一件事（可编辑区上的 `flex h-full`），已经靠外壳外居中修好。高度锁是遗留物。

## 2. 业界两族

| 族 | 代表 | 对齐方式 | Pier 是否采用 |
|---|---|---|---|
| A 文本实体 | Lexical playground `MentionNode`（`TextNode` + 底色）、TipTap Mention（继承字号的 `<span>` + 少量 padding） | 它就是文字，天然共基线 | **否。** 会丢掉整颗删除、图标、Chromium 光标槽 |
| B 原子控件 | Slack 文件芯片、Cursor `@file`、Pier 四颗 `DecoratorNode` | 字号级胶囊 + 标签基线 | **是。** 保留装饰语义，视觉密度对齐 A 族 |

B 族做对的产品：芯片高度 ≈ em 盒 + 2–4px（**不等于行高**），标签 `1em`，宿主 `vertical-align: baseline`，基线取自标签不是盒子中点。

否决：继续 `h-5` 再用 `vertical-align: -Npx` 光学微调（治标，换字体/缩放还会歪）。

## 3. 不变量

1. 芯片标签基线 == 旁边正文基线。
2. 标签字号 `1em`（编辑器 `text-sm`）。禁止共享 class 上的 `text-[0.85em]` 或更小覆盖。
3. 胶囊随内容收缩。禁止 `h-5` / `max-h-5` / 宿主 `height: 1.25rem`。行盒仍由编辑器 `leading-5` 决定。
4. 宿主是基线对齐的 `inline-flex`，不是中点对齐的替换盒。
5. `::before`/`::after` 只做 0.25rem 光标槽，`height: 0`，不得贡献字体 strut。
6. 胶囊内部 `items-center`（图标对标签）；宿主 `align-items: baseline` + `vertical-align: baseline`。
7. 芯片旁光标可以比正文光标矮约 2px。不要为了藏这一点把宿主拉回 `1lh`。
8. 圆角 / 最大宽度 / 截断 / 槽宽 / 原子选区不变。
9. 色相只分 3 族合法 + 2 态：引用 `@` = `status-info` 蓝；调用（命令+技能）= `status-success` 绿（`COMPOSER_CHIP_TONE_INVOKE`）；载荷附件 = `status-done` 紫；附件失效 = `status-warning`；审阅 = `destructive`。命令不得再用 `secondary` / `muted` / `status-neutral`。命令 vs 技能靠 `SquareSlash` / `Zap`，不靠色相。

标识类文案（路径、技能 id）在**标签 span** 上保留 `font-mono`。芯片外壳和附件序号继承编辑器无衬线。

## 4. 实现入口

- 宿主：`src/renderer/app/globals.css`（`.composer-ref-chip-host`）
- 共享壳：`COMPOSER_CHIP_CLASS`（`composer-chip-styles.ts`）
- 禁止以后再引入：`h-5`、`0.85em`、`vertical-align: middle`、宿主 `height: 1.25rem`

jsdom 量不出像素基线。契约由治理测试锁源码，目视在 Electron 紧凑增强输入里确认。
