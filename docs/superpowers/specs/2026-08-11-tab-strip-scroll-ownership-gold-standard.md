# 工作台 Tab 条滚动所有权金标准终态方案

日期：2026-08-11  
状态：**草案（P0–P5 代码与验收项已落地；产品附录 B 未确认）** — 意图优先级、写路径、R2 patch、e2e G3/G4、治理扫描已齐；附录 B 产品项与 sash（S5）仍可单独立项。  
实现进度：**P0–P3** 见前；**P4** `patches/dockview-core@7.0.2.patch` 保留 Scrollbar offset + restore 改 ResizeObserver settle（禁嵌套多 rAF）；**P5** `tab-strip-scroll-governance.test.ts` 锁白名单 / patch / host 接线。  
范围：dockview **每个 group 的 tab 条**（`.dv-tabs-container` 的水平 `scrollLeft`）及 Pier 侧 **reveal active tab**。  
不包含：面板正文滚动、文件树、编辑器、工作台物料网格。

产品硬约束（继承，不得用本文开脱）：

- 布局引擎仍是 dockview；**禁止**为 tab 条自研第二套 tab 控件或 fork 整份 dockview 运行时当常规交付。
- 终端内容点击恢复输入时 **不得** 为了「看见 tab」而强行把 tab 条滚到 active（已有 e2e 锁）。
- renderer 业务不得散落直写 `.dv-tabs-container.scrollLeft`；程序化滚动只走 §4 管道。
- 用户可见文案与产品词规范不变（本文无新用户文案）。

### 文档层级（冲突时）

| 文档 / 代码 | 角色 | 与本文关系 |
|-------------|------|------------|
| **本文** | tab 条滚动意图与写路径 **终态权威** | 权威 |
| `2026-08-10-file-tree-scroll-ownership-gold-standard.md` | 文件树滚动单意图原则 | **原则同源**（用户优先、单写者、禁症状 rAF）；作用域不同 |
| `2026-07-31-git-review-gold-standard-endstate-design.md` | Review 正文滚动 | 原则同源；作用域是正文 |
| `src/renderer/lib/workspace/tab-visibility.ts` | reveal 几何 | 须对齐 §4 reveal 意图 |
| `src/renderer/lib/workspace/tab-strip-scroll.ts` | maximize 记忆 / restore | 须收敛到 §4 / §8 |
| `src/renderer/components/workspace/tab-strip-behavior.ts` | host 挂载入口 | 须收敛到 §4 / §8 |
| `src/renderer/lib/workspace/terminal-focus-request.ts` | 终端 surface 激活 | **reveal: never** + suppress 为硬契约 |
| `tests/e2e/native/terminal-focus.spec.ts` | 终端 surface 不 reveal | 契约测试；终态不得破坏 |

**实现禁令：** 未对照本文时，禁止再合「只加长 rAF 帧数 / 只全局 MutationObserver / 只在 host 再挂一套 scrollLeft」类症状补丁充当终态。  
**里程碑：** PR 可切片，但 **G0–G5 全绿前不得宣称 tab 条滚动已金标准**。

---

## 0. 一句话终态

> **每个 group 的 tab 条在任意时刻只有一个合法滚动意图；用户手滚永远优先；布局扰动（含 maximize 隐藏）必须恢复「扰动前的用户视口」而不是默认贴左；程序化「看清当前 tab」只在明确的聚焦 / 激活路径上发生一次，且不得压过终端内容点击的 no-reveal 契约。**

---

## 1. 标杆对照

### 1.1 文件树 / Review（原则层）

| 原则 | 文件树 / Review 终态 | tab 条终态用法 |
|------|----------------------|----------------|
| 滚动单写者 | 禁止多路径并行写 `scrollTop` | Pier 侧程序化写 `scrollLeft` 只经 **tab-strip scroll owner** |
| 用户阅读不被冲 | wheel 抢占 in-flight 程序滚 | 用户滚动中取消可取消的 restore / reveal |
| 应用层定位次数 | reveal ≤1 次 | group 聚焦 / 显式激活 → **至多一次** reveal |
| 禁症状多帧死钉 | 禁止 rAF 死钉当结案 | restore 以 **ResizeObserver + 至多 1 次 rAF + 超时兜底** settle；**禁止**嵌套多 rAF 死钉 |

### 1.2 VS Code 工作台（产品体感）

| 体感 | VS Code | Pier 终态 |
|------|---------|-----------|
| 多 tab 横向滚动 | 跟手；切到其它 editor group 再回来位置仍在 | 同：maximize / 其它 group 最大化后还原 |
| 溢出提示 | 无常驻横条；溢出入口 / 边缘暗示 | **溢出 ▾ 菜单** + **横向 scroll-fade**（`scrollFadeUnsafeCss` → `tab-strip-scroll-fade.ts` 注入，与 ScrollArea / 文件树同构） |
| 激活 tab | 激活时保证 tab 在条内可见（nearest） | 同：显式激活 / 分组聚焦；**例外**见 K5 |
| 点编辑器正文 | 不把 tab 条猛地拽回 active（多数情况 tab 已可见） | 同；终端 surface **强制** no-reveal |
| 刷新窗口 | tab 条 scroll 一般不跨会话持久化 | 同：**不**写入 layout JSON（K8） |

---

## 2. 问题与根因（可证伪）

### 2.1 必须消灭的体感

| ID | 体感 |
|----|------|
| S1 | tab 过多时手动滚到右侧后，**另一分组 maximize / 还原**，本条 tab 滚回最左 |
| S2 | 分组很多 tab 时，**点另一分组窗口（内容 / 标题栏区域）聚焦**后，当前 active tab 仍被裁切在视野外，看不出「现在是谁」 |
| S3 | 点终端内容恢复输入时，tab 条被程序滚到 active，打断用户刚调好的横向位置（**禁止**，已锁） |
| S4 | 还原 maximize 后偶发先贴左再弹回 / 与自定义滚动条「抢」位置 |
| S5 | 仅拖 sash 改 group 宽度后，tab 条视口无故跳到 0（与 maximize 同源或 clamp 不当） |

### 2.2 根因分层

| ID | 根因 | 机制索引 |
|----|------|----------|
| R1 | **Maximize 隐藏 leaf** | `gridview.maximizeView` → `setChildVisible(false)` → size=0 |
| R2 | **dockview 自定义 Scrollbar 在无溢出时清 offset** | `scrollbar.js`：`hasScrollbar === false` → `_scrollOffset = 0`；resize 后再写回 `scrollLeft` |
| R3 | **滚动状态不在 layout 模型内** | dockview / Pier layout JSON **不**序列化 tab strip `scrollLeft`（正确）；故须会话内记忆，而非 fromJSON |
| R4 | **多写者无优先级** | 用户滚、dockview `setActivePanel`、Pier reveal、Scrollbar resize、maximize restore 均可写 `scrollLeft` |
| R5 | **reveal 策略按调用点散落** | overflow / 快捷键 always；终端 never；分组聚焦曾缺失 → 补丁式挂事件 |
| R6 | **事后事件 freeze 偏晚** | `onDidMaximizedGroupChange(true)` 时其它 group 已 hide；依赖 hide 前 scroll 监听已写入 |

**非根因（禁止当主线）：** overflow 下拉菜单本身、tab 标题 i18n、终端 firstResponder 交换（与 S3 相关但滚动契约独立）。

---

## 3. 关键决策（冻结草案）

| # | 决策 | 理由 |
|---|------|------|
| **K1** | 每个 group 的 tab 条程序化滚动由 **单一 owner 模块** 调度（现 `tab-strip-scroll` + `tab-visibility` 须合并契约，禁止第三处直写） | 对症 R4 |
| **K2** | **意图优先级（高 → 低）**：`user` ＞ `layout-restore`（maximize / 可见性恢复）＞ `reveal-active` ＞ dockview 内建 active-panel scroll | 用户手感优先；布局恢复优先于「看清 tab」 |
| **K3** | **用户意图**：wheel / 触控板 / 滚动条拖拽 / 程序外的 `scroll` 且非 owner 发起 → 记为 `user`，并 **abort** 未 settle 的 `layout-restore` / `reveal-active` | 对症 S4 抢滚 |
| **K4** | **layout-restore**：在 group 即将不可见或 size→0 **之前** 快照 `scrollLeft`；重新可见且 `clientWidth > 0` 后 **至多一次**（几何 settle 后）写回并 clamp；**禁止**无限 rAF 循环 | 对症 S1 / R1 / R6 |
| **K5** | **reveal-active** 仅允许：① 用户点 tab / overflow 选 tab；② 快捷键 `pier.panel.focusTabN` 等显式激活；③ **active group 发生变化**（点另一 group 的 chrome 或非终端 surface 内容导致 group 激活）；④ 新建 panel 落条。**禁止**：终端 surface focus-request；同 group 内重复 setActive 且 panel 未变 | 对症 S2 / S3 / R5 |
| **K6** | 终端 `activateTerminalPanelFromFocusRequest` **永远** `reveal: never`，并用同步 suppress 挡住同回合 `onDidActiveGroupChange` 触发的 reveal | 锁 e2e；对症 S3 |
| **K7** | 修根因 R2：dockview-core patch 在无溢出时 **保留** `_scrollOffset`；restore 不再依赖嵌套多 rAF | 对齐文件树禁令 |
| **K8** | tab 条 `scrollLeft` **不**写入 workspace layout JSON；跨窗口 transfer / 冷启动归 0 可接受 | 避免 layout 膨胀与还原竞态 |
| **K9** | G0–G5 全绿前不得称金标准；P0 补丁可合但须在 PR/文档标明「非金标准」 | 防口号跑赢验收 |

---

## 4. 意图状态机（终态）

```
                    ┌─────────────┐
                    │    idle     │
                    └──────┬──────┘
           user scroll     │     explicit activate / group focus
                 │         │              │
                 ▼         │              ▼
           ┌──────────┐    │       ┌────────────────┐
           │   user   │◄───┴───────│ reveal-active  │  (≤1 settle)
           └────┬─────┘            └────────┬───────┘
                │ abort                      │ abort if user
                │                            │
     maximize hide / show                    │
                ▼                            │
       ┌─────────────────┐                   │
       │ layout-restore  │◄──────────────────┘  (restore 优先于 reveal
       │  snapshot→apply │     若同回合冲突：先 restore，本回合不再 reveal)
       └─────────────────┘
```

### 4.1 写路径白名单

| 意图 | 谁可以写 `scrollLeft` | 次数 | 可被 user abort |
|------|----------------------|------|-----------------|
| `user` | 浏览器默认（wheel 等） | 连续 | — |
| `layout-restore` | tab-strip owner only | 每组每次「重新可见」≤1（settle 内允许 1 次校正） | 是 |
| `reveal-active` | `revealElementWithinScrollContainer` only | 每次触发意图 ≤1 | 是 |
| dockview 内建 | 仅 `Tabs.setActivePanel` 路径 | 切 tab 时 | 是（随后 user 可滚走） |

**禁止：** 业务组件、panel-kit、插件直接 `querySelector('.dv-tabs-container').scrollLeft = …`。

### 4.2 快照键

- 键：`group.id`（dockview 稳定 id）。
- 值：`scrollLeft`（number）；可选将来扩展 `scrollTop`（竖向 header 时）。
- 生命周期：renderer 会话内；group 销毁时删除键。
- **不**持久化。

### 4.3 Maximize 时序（终态）

```
[用户触发 maximize]
  → owner.snapshotAllVisibleGroups()   // 仍在 size>0
  → panel.api.maximize() / exit
  → dockview hide/show + layout
  → owner.onGroupVisible(group)        // clientWidth>0
  → owner.applyLayoutRestore(group)    // ≤1 + clamp
  → （本回合不自动 reveal，除非 active group 也变且策略要求）
```

P0 用 `onDidMaximizedGroupChange` + freeze **近似** 该时序，但快照偏晚，见 §8 缺口。

### 4.4 分组聚焦 reveal（终态）

| 触发 | reveal |
|------|--------|
| `onDidActiveGroupChange` 且 **非** tab-reveal-suppressed | 对该 group `activePanel.id` reveal 一次 |
| 同 group 内仅 `onDidActivePanelChange`（点另一 tab） | 可依赖 dockview 内建 + 现有 `reveal: always` 调用点；owner 不重复 reveal |
| 终端 surface focus-request | **不** reveal |
| Electron 窗从后台回前台、group 未变 | **不** reveal（非目标，见 §6） |

---

## 5. 与 P0 实现对照（缺口表）

代码入口（P0）：

- `src/renderer/lib/workspace/tab-strip-scroll.ts`
- `src/renderer/lib/workspace/tab-reveal-suppress.ts`
- `src/renderer/lib/workspace/tab-visibility.ts`
- `src/renderer/components/workspace/tab-strip-behavior.ts`
- `src/renderer/components/workspace/host.tsx`（attach）
- `src/renderer/lib/workspace/terminal-focus-request.ts`

| 终态条款 | P0 状态 | 缺口 |
|----------|---------|------|
| K1 单 owner | **P5 治理已锁** workspace 域 `scrollLeft` 白名单 | 插件/其它域另册 |
| K2 优先级 | user abort + restore/reveal 分轨 | 无完整意图枚举对象（可接受） |
| K3 user 优先 | **P2 已做** | — |
| K4 提前快照 | **P1 已做** | 直调 `panel.api.maximize` 仍仅事件 freeze 兜底 |
| K5 reveal 场景 | 基本对齐 + e2e G4 | suppress 全局深度可接受 |
| K6 终端 no-reveal | **已做** | e2e 锁 |
| K7 修 R2 | **P4 已做**（`dockview-core@7.0.2` patch） | 需随 dockview 升级 rebase patch |
| K8 不持久化 | **已做** | — |
| S5 sash 缩放 | **未做** | 可选后续 |
| 写手数探针 | 治理扫描替代 | — |

**结论：** P0–P5 主路径 + R2 + e2e G3/G4 + 治理 **已齐**；宣称产品「金标准」仍须附录 B 确认与（可选）S5。

---

## 6. 非目标（明确不做）

| 非目标 | 说明 |
|--------|------|
| 跨会话 / layout JSON 持久化 tab scroll | K8 |
| Electron 窗级 focus（key-window）自动 reveal | 与「分组聚焦」不同；需要时另开需求 |
| 替换 dockview tab UI | 硬约束 |
| 竖向 tab 条完整产品化 | 若启用，再扩 `scrollTop` 记忆 |
| 用 toast / 动画提示「已恢复滚动」 | 噪声 |
| 第三方插件自定义 tab 条滚动 API | 无 |

---

## 7. 验收（G0–G5）

宣称金标准前须全绿。

| ID | 验收项 | 类型 |
|----|--------|------|
| **G0** | 本文合入；P0 代码与 §5 缺口表一致；PR 描述不写「金标准完成」 | 文档 / 评审 |
| **G1** | 单元：snapshot → hide(size0) → show → restore 精确值；freeze 期间 0 不污染 memory；reveal 几何；suppress 深度 | unit（已有部分） |
| **G2** | 单元 / 组件：意图优先级 — restore 进行中模拟 user scroll 后，第二帧不得盖回 | unit |
| **G3** | e2e：双 group、右 group 多 tab 滚出 → 左 group maximize → 还原 → 右 `scrollLeft` 与 maximize 前一致 | e2e **已绿**（`maximize restore keeps the other group's tab strip scrollLeft`） |
| **G4** | e2e：多 tab 使 active 不可见 → 离开后经 **分组导航**（`Ctrl+Shift+ArrowRight` / `reveal: always`）回来 → active tab 完全可见；终端 surface 跨 group 仍 **不** reveal（同文件既有用例） | e2e **已绿**（`group focus navigation reveals the active tab`） |
| **G5** | 根因：无嵌套多 rAF 死钉；R2 patch 在位；workspace `scrollLeft` 白名单治理 | **已绿**（`tab-strip-scroll-governance.test.ts` + owner 实现） |

探针建议（G2/G5）：

- `layoutRestoreWriteCount` / `revealWriteCount` 可测计数（测试专用或 `import.meta.vitest`）。
- 禁止 `scheduleRestore` 默认 `frames > 2` 无注释与 allowlist。

---

## 8. 落地切片（PR 计划）

| 阶段 | 内容 | 退出标准 |
|------|------|----------|
| **P0**（已完成） | scroll 记忆、maximize freeze/restore、active group reveal、终端 suppress | S1/S2 主路径；S3 e2e |
| **P1**（已完成） | maximize/equalize **入口** snapshot+freeze | R6 缩小 |
| **P2**（已完成） | 用户 scroll abort in-flight restore/reveal | G2 |
| **P3**（已完成） | e2e G3/G4（CLI 建 tab + UI maximize / focusRight） | G3 G4 绿 |
| **P4**（已完成） | `patches/dockview-core@7.0.2.patch` 保留无溢出 offset；restore → ResizeObserver settle | G5 根因 |
| **P5**（已完成） | `tab-strip-scroll-governance.test.ts` 锁 patch / 白名单 / host 接线 | 防回归 |

---

## 9. 风险与回滚

| 风险 | 缓解 |
|------|------|
| restore 与 dockview setActive 同帧双写闪动 | K2：同回合 restore 优先，跳过 reveal |
| suppress 全局深度误伤并发激活 | suppress 仅包 terminal focus-request 同步栈；禁止异步延后 suppress |
| native scrollbar 主题变化视觉差异 | P4 单独验收深浅色 |
| 记忆泄漏（group 删除） | dispose 时按 `api.groups` 收敛 keys；group remove 事件删键 |

回滚：detach `attachWorkspaceTabStripBehavior` 即可回到「无记忆 / 无 group reveal」；终端 never 可保留。

---

## 10. 实现索引（P0）

| 能力 | 路径 |
|------|------|
| scroll 记忆 / freeze / restore | `src/renderer/lib/workspace/tab-strip-scroll.ts` |
| reveal suppress | `src/renderer/lib/workspace/tab-reveal-suppress.ts` |
| reveal 几何 | `src/renderer/lib/workspace/tab-visibility.ts` |
| host 订阅 | `src/renderer/components/workspace/tab-strip-behavior.ts` |
| 挂载 | `src/renderer/components/workspace/host.tsx` |
| 终端 no-reveal | `src/renderer/lib/workspace/terminal-focus-request.ts` |
| R2 patch | `patches/dockview-core@7.0.2.patch`（`pnpm-workspace.yaml` patchedDependencies） |
| 单测 | `tab-strip-scroll.test.ts`、`tab-reveal-suppress.test.ts`、`tab-strip-behavior.test.ts` |
| 治理 | `tests/unit/renderer/workspace/tab-strip-scroll-governance.test.ts` |
| e2e G3/G4 | `tests/e2e/native/terminal-focus.spec.ts` |

---

## 附录 A. 与「是否金标准」问答

| 问题 | 答案 |
|------|------|
| P0–P5 算实现金标准吗？ | **工程验收 G0–G5 主路径已绿**；产品「金标准」仍待附录 B 与可选 S5。 |
| 能否在发布说明写「已修复 tab 滚动」？ | **可以**（S1/S2）；升级 dockview 时必须 rebase `dockview-core@7.0.2` patch。 |
| 还剩什么？ | 附录 B 产品确认；可选 sash（S5）；dockview 大版本升级时 patch 维护。 |

---

## 附录 B. 决策待产品确认

以下条款以草案冻结；若产品否决，改本文再改代码：

1. **K5**：分组聚焦是否包含「点同窗口内另一 group 的终端 surface」——现行 **否**（K6 优先）。  
2. **K8**：是否永远不持久化 tab scroll。  
3. **S5**：sash 缩放是否纳入 G3 同级必修。  
4. **窗级 focus**：是否另开需求做 reveal。
