# 工作台面板 Tab 铬金标准

日期：2026-08-29  
状态：**实现中**  
范围：dockview **group 内面板 tab**（`.dv-tab` / `PanelTabHeader`）的分割短线、悬停、选中底。  
不包含：窗口级标题栏 tab（loomdesk `window-tab-strip`）、tab 条滚动（见 `2026-08-11-tab-strip-scroll-ownership-gold-standard.md`）。

硬约束：布局仍是 dockview；禁止自研第二套 tab 条。短竖线用真实节点，不用 dockview `::before`。

---

## 0. 产品形态（先定族，再抄细节）

Pier 面板 tab 是 **矩形工作台 tab**（VS Code 编辑器 tab 一族）：

- 条底是 `--sidebar`；选中 tab 底是内容 `--background`，顶缘 S1/S2/S3 指示线
- 不是 Chrome / loomdesk 窗口 tab（圆角凸起、和内容区咬合的「页签」）

抄错族就会出现：做成圆角凸起页签、把短线画进内容 padding（两边空隙不对称）、悬停只藏一边短线。

---

## 1. 标杆对照

| 项 | Chrome 窗口条 | loomdesk 窗口条 | VS Code 编辑器 tab | Pier 面板 tab 终态 |
|----|---------------|-----------------|--------------------|-------------------|
| 形态 | 圆角凸起页签 | 同左，`data-active-tab-bg` | 矩形，选中换底 | **矩形，选中换底** |
| 分割 | 短竖线，inactive 之间 | `TabsSeparator`：`w-px h-3.5`，插在 tab **之间** | `tab.border` 贴缝 | 真实短线贴 **两颗 tab 的接缝**，`1×14px`（`h-3.5`） |
| 线两侧空 | 约 2px 边距 + 页签自身 padding | 列表 `gap-0.5`（2px）+ 线 1px，左右对称 | 内容左右 padding 相等，线在接缝 | **外层 `.dv-tab` padding 0；内层 `12px / 6px`；线在接缝** |
| 贴选中 | 藏（选中底已切开） | 藏 | 选中底已切开，不靠线 | **藏**（选中底 `--background` 已切开） |
| 贴悬停 | 藏（悬停也有凸起形状） | 藏 | 不藏（悬停只是底色微亮） | **藏**（`--list-hover-bg` 已切开） |
| 悬停信号 | 形状 + 底 | `group-hover:bg-background/60`，字仍 muted，选中才 `foreground` | `tab.hoverBackground` 为主，可加 `hoverForeground` | **底 `--list-hover-bg` 为主；字/通用图标到 `--foreground`** |
| 选中 | 凸起 + 内容底 | 凸起 + 内容底 | 内容底 + 顶/底强调线 | 已有：内容底 + S2/S3 顶线 |

Chrome / loomdesk 窗口条在悬停时藏线，是因为悬停 tab **已经变成一块独立形状**。Pier 没有凸起页签，但悬停洗底（`--list-hover-bg`）已经把该 tab 切出来；贴边短线会变成双边缘。短线只留在两颗都是 idle（非选中、非悬停）的邻居之间。

---

## 2. 冻结决策

| # | 决策 | 理由 |
|---|------|------|
| K1 | 短竖线是 `PanelTabHeader` 内 `[data-slot="panel-tab-separator"]`，不用 dockview `::before` | 与 loomdesk `TabsSeparator` 同构；dockview 条里有非 tab 子节点，`:first-child::before` 不可靠 |
| K2 | 线画在 **tab 外接缝**（内层 `left: 0`，且外层 `.dv-tab` 无水平 padding） | 线落在两颗 tab 的接缝上，不再画进内容 padding 里 |
| K3 | 左 inset 12px；右 inset 6px（`padding-inline: 12px 6px`） | 对齐的是 **字形到接缝**，不是盒子。× 为 18px 热区里的 12px 图标，已有 ~3px 内缩；右侧再给与左侧相同的 12px 会明显偏空 |
| K4 | 分割线 **只**在两颗 idle（非选中、非悬停）之间显示。隐藏：条内第一颗；选中 / 悬停 tab 自己的线；其右侧邻居的线 | 选中底和悬停洗底已经切开，线是多余双边缘 |
| K5 | **悬停藏两侧短线**（与选中同构：自己的线 + 右侧邻居的线） | 悬停主信号是 `--list-hover-bg` 块面；贴边短线与选中一样是双边缘 |
| K6 | 悬停主信号是底（`--list-hover-bg`）。**同时**把标题（`.dv-default-tab-content`）收到 `--foreground` | 只改底，muted 标题在洗底上仍发灰；只改字没有「可点」的块面。两者一起才是 VS Code 默认。文件类型图标保持 token 色 |
| K7 | 悬停不得做成选中：禁止换 `--background`、禁止圆角页签、禁止再加顶线 | 选中语义只留给 S2/S3 |
| K8 | 只给 inactive tab 悬停底。选择器必须压过 dockview `.dv-groupview > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-inactive-tab`（0,6,0）。选中 tab 已是内容底，不再叠洗 | 短 `.dv-inactive-tab:hover` 盖不住 dockview 的 transparent 底 |

---

## 3. 几何

```
| 12px | 图标 标题 [18px ×] | 6px || 12px | 图标 标题 [18px ×] | 6px |
                                 ↑
                            1×14px 短线（接缝，属于右 tab）
```

- 外层 `.dv-tab`：`padding: 0`（接管 dockview `0.25rem 0.5rem`）
- 内层 `.dv-default-tab`：`padding-inline: 12px 6px`；有活跃任务点时左 18px（12px gutter + 6px 点）
- × 热区 18×18、字形 12px，热区贴着 6px 右缘；视觉上图标←12px→接缝←约 9px→× 字形
- 短线：`width: 1px; height: 0.875rem; top: 50%; translateY(-50%); left: 0`
- 颜色：`foreground` 14% 混合（`--border` 10% 暗底几乎看不见；20% / 32% 仍偏实，会抢标题）
- dockview 通高 `::before`：`content: none`

---

## 4. 检查点

- `tests/unit/renderer/styles/dockview-tab-focus-css.test.ts`：锁 K1–K8 选择器 / padding / `--list-hover-bg` / 悬停藏两侧短线
- `tests/component/app/panel-tab-header.test.tsx`：锁真实节点存在

实现禁令：禁止把短线 `left` 写进内容 padding 里用负值猜接缝；悬停藏线必须同时藏自己的线和右侧邻居的线，禁止只藏一边。
