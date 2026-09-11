# 侧栏设计 · 独立审查记录

2026-09-09。仅审查和修复本目录的侧栏 Canvas，不包含工作台正文或真实宿主接线。

## 最新：工作树与会话归属修正

用户后续指出，父工作树与子会话的同宽胶囊会被看成同级。前四轮评分漏掉了这一点，不能作为本次修正前层级已清楚的证明；以下旧结果作为历史保留，不继承为本稿的新评分。

- 会话改为真正内缩的子列表，背景和点击区域随列表收窄；使用项目 `sidebar-border` 的 1px 中性引导线，只连接所属会话。
- 组内 2px、工作树组间 8px。保持公开 Item 的胶囊、字体、焦点，以及 28px 行高；没有新增卡片、普通颜色或宿主代码。
- 24 组实测：224 / 256 / 320px × 四语言 × 深浅主题，560px 高，下载中。子按钮比父按钮内缩 32 / 36px；无横溢，会话标题完整，所有行 28px。空子列表高 0 / 边框 0。
- 224px 普通目录内缩 24px；方向键移到会话后原生 3px focus-visible 环可见，左侧 8px 净空，祖先不裁切。仅移动焦点不会导航。
- 本次真实 Live Modules 编译、公开 SDK 类型、两文件 Biome 显式检查通过；11 项既有交互回归通过（2026-09-09 15:59）。

[同态待处理局部](audit/hierarchy-attention-detail.jpg) · [同态完整侧栏](audit/hierarchy-attention-dark.jpg) · [深色稿](audit/hierarchy-dark.jpg) · [浅色稿](audit/hierarchy-light.jpg) · [窄栏英文](audit/hierarchy-narrow.jpg) · [分组局部](audit/hierarchy-detail.jpg) · [24 组原始几何](audit/hierarchy-geometry.json) · [普通目录与焦点](audit/hierarchy-interaction.json)。

独立专项结论：[A 层级审查](audit/assessment-a-hierarchy.md) 与 [B 项目 / shadcn 复核](audit/assessment-b-hierarchy.md) 均无已确认待修问题。A 初报 9.0 没有预设量表或对应扣分证据，已撤回其作为验收门槛的用途；没有为了满足 9.5 目标改高分，也没有将旧总分继承给本次修正。当前结论是列明状态与规范的通过，不宣称新的全量总分。

## 历史：第四轮结果（层级结论已由后续反馈纠正）

- 独立 A：视觉 **9.6/10**；Nielsen 用户体验 **32/32，即 10.0/10**。八项适用启发式均无确认缺口；错误预防与错误恢复在此演示范围内不适用，没有用虚构流程补分。
- 独立 B：**项目规范、shadcn 组合与样式边界、最佳实践、风格与直接回归均 PASS**，限本 Canvas 已审范围。B1–B4 均有对应修复和复测证据。
- 独立颜色检查：采集的文字组合均达到 4.5:1；状态点和工具图标均达到 3:1。第四轮新增的 14 个实际样本全部通过；最终稿已删除第三轮红绿主题映射及其较小的浅色悬停余量。
- 主会话负责修复、浏览器操作及最终编译验证；没有将 detector 的空结果当作设计评分。

[打开 Canvas 源文件](workbench-sidebar-review.canvas.tsx)。[A 最终完整报告](audit/assessment-a-round4.md) · [B 最终完整报告](audit/assessment-b-round4.md) · [颜色实证报告](audit/color-check-round4.md)。

## 循环与问题闭环

| 轮次 | A 用户体验 | A 视觉 | 审查发现与处理 |
| --- | ---: | ---: | --- |
| 1 | 8.1* | 8.2 | 当前会话高亮被警告底覆盖；224px 设置和短工作树名被挤压；键盘帮助未呈现；画板表单绕过 Field；从最近项目恢复时焦点和 live status 丢失。逐项修复。 |
| 2 | 9.7 | 9.4 | 256px 恢复摘要后反而截断名称；专项测出增删数字、次要文字和状态点的对比度不足。第三轮修正空间与语义色组合。 |
| 3 | 10.0 | 9.6 | 设计分达标，颜色和几何通过；B 仍拦下设置标签覆盖 Button tone、GIT 业务 CSS 按主题换令牌族。没有因此提前结束。 |
| 4 | 10.0 | 9.6 | 使用共享 Button 默认 tone，摘要统一语义继承；A 无待改问题，B 所有已确认问题关闭，最终新增颜色样本与回归通过。 |

\* 首轮 A4 要求侧栏运行点常驻动画，是适用范围误判。详细规格 L0 明确禁止常驻动画，侧栏使用静态状态点；审查者已撤回 A4 和对应硬 FAIL。保留原始评分记录，不把全部分数提升描述为代码修复收益。

| 已确认问题 | 最终处理 | 实证 |
| --- | --- | --- |
| 需要处理覆盖当前会话 | 当前背景优先，保留 warning 文字和状态点 | current 与背景随定位同步变化 |
| 窄栏底部挤压 Settings | 文字不收缩；下载控件保留 28px，高度不变，仅收紧横向布局 | 224px 英文 Settings 55/55px；42% 31/31px |
| 短名称与摘要争空间 | ≤280px 使用 8px 层级步进、工作树 4px 槽间距；≤240px 隐藏行内摘要 | 24 组 pier、harbor、sidebar-switching、review-layout 均完整 |
| 选项表单组合缺失 | 使用公开 FieldGroup / Field / FieldLabel；id 与 aria-labelledby 对应 | 5 个 Field、5 个唯一标签，控件和选项均 28px |
| 空态导航丢焦点 / 播报 | 场景切换保留 Sidebar 实例；最近项目恢复后聚焦对应工作树 | focus-visible=true；一个当前工作树、零旧会话定位；唯一 polite status 有完成文字 |
| 颜色令牌放错背景 | 全部 GIT 数字统一侧栏前景，保留正负号、准确数量与完整提示；删除主题分支 | 选中数字深 11.8317、浅 14.4909；普通与 hover 数字均 ≥4.5 |
| 次要文字过浅 | 次要内容使用侧栏前景；文字工具选公共 Button 默认 tone，纯图标控件用 muted；通过字号、位置和间距区分层级 | 设置、进度与分组文字两主题通过 |
| 空闲 / 运行点不清楚 | 空闲点不再降低透明度；运行点使用 2px sidebar 底衬 | 蓝点直接邻接比值深 3.3370、浅 5.6471 |
| 普通 Button 标签被二次上色 | 删除后代颜色规则，设置 / 下载中用公共 Button 默认 tone | 两主题标签与图标一致，文字比值 16.5821 / 18.1470 |
| GIT 语义映射含主题分支 | 改为单一 sidebar-foreground，宿主变量负责明暗 | 无 diff/status 主题条件，正负号和数值保留 |
| 默认 Item hover 不可见 | 将普通行 hover 映射既有 list-hover-bg；选中与警告优先 | 实际 hover=true，背景与 sidebar 不同 |

没有新增普通 UI 色值、全局令牌、第二套侧栏实现或工作台正文。没有修改仓库中与本任务无关的暂存改动。

## 历史：第四轮截图

图片来自同一 SidebarDesign 和项目真实公开组件；不是图片生成或独立仿制 UI。

| 深色默认，无更新 | 224px 英文，下载中 |
| --- | --- |
| ![深色默认侧栏](audit/round-4-dark.jpg) | ![窄栏英文下载中](audit/round-4-narrow-en-downloading.jpg) |

[320px 浅色远程场景](audit/round-4-remote-light.jpg) · [日语空态](audit/round-4-empty-ja.jpg) · [深色运行会话选中态](audit/round-4-selected-running-dark.jpg) · [浅色运行会话选中态](audit/round-4-selected-running-light.jpg)。

## 验证方法与范围

- A 独立进行 Impeccable 设计审查和评分；B 独立核对项目 / shadcn、数据、公开 API 和 actual detector；第三位 agent 独立计算颜色。每轮 A 完成前不读取 B 的结果。
- 第一轮 A / B 各自操作浏览器。后续子 agent 浏览器能力断开，由其给出明确步骤，主会话作为操作员采集原始数据；子 agent 独立判断。未把主会话操作冒充子 agent 独立操作。
- 临时 QA 仅挂载真实 `SidebarDesign` 或真实 Canvas 入口，使用当前 `pierCanvasExports` 与 `globals.css`；不是第二套产品实现。旧安装版 Pier 的原生窗口操作不稳定，因此浏览器结果不冒充 Electron 全链路验证。
- 截图器存在缩小输出，清晰图用 captureScale=2 补偿，**只用于看外观**。所有几何验收均在 captureScale=1、字体加载完成后进行。动态 hover 的最终颜色在组件过渡结束后采样。
- 24 组：224 / 256 / 320px × 中文 / 英文 / 日文 / 韩文 × 深 / 浅色；560px 高、下载中。全部侧栏无横溢出，行与工具按钮为 28px，短名称和底部文字无截断。另有 800px、远程、空态、待重启截图，未宣称四场景的所有排列组合均已测试。
- 公开 SDK TypeScript 检查与实际 Live Modules 编译通过；无未处理 glob。三个改动代码文件经 Biome 显式 stdin 写入模式检查，exit 0 且输出与原文一致；没有把根配置排除 Canvas 后的“检查零文件”当作通过。
- 11 项交互回归在行为修复后和第四轮 Button 变体调整后均通过，覆盖选择、跨窗演示、未读、键盘、更新状态、四语及真实 Canvas 选项。最后运行 2026-09-09 15:40，11/11；CSS 的效果由浏览器矩阵和颜色读数验收。
- 临时 QA 早期 HMR 出现重复 createRoot 历史错误，已为临时挂载器补卸载；后续重新导航未见新增错误。没有把该临时工具问题归因于 Canvas 源码。

## 颜色例外与未验证范围

浅色选中行 identity-1 对强调底的亮度比为 **2.7814:1**，仍明确记录。身份色块与可见名称是冗余编码，不承担唯一信息；它不借用 badge 的 Tier 3 豁免。六个身份色在规格要求的 sidebar / background 上均达到 3:1。没有为此在 Canvas 私自重调项目身份色。

结果限定于本侧栏设计稿及列明样本：未验证真实工作树整体切换、布局持久化、NCS 投递、实际更新下载 / 重启、Ghostty 原生合成、完整屏幕阅读器朗读、全部主题预设和 200% 系统字号。示例路径、会话、窗口名、GIT 数字与 42% 进度仍明确是演示数据。

本次设计范围内的通过，不能改写为整个 Pier 产品、所有宿主版本或全部无障碍场景的认证。

## 原始证据

- [第三轮 24 组几何](audit/layout-matrix-round3.json)
- [第四轮 computed 颜色及祖先链](audit/computed-colors-round4.json) · [最终变更组合比值](audit/computed-color-ratios-round4.json)
- [第三轮未变状态证据](audit/computed-colors-round3.json) · [真实 hover 颜色](audit/computed-colors-hover-round3.json) · [独立比值计算结果](audit/computed-color-ratios-round3.json)
- [Field / 空态焦点实测](audit/interaction-fields-round2.json) · [选择与方向键实测](audit/interaction-selection-round2.json)
- [第三轮 A](audit/assessment-a-round3.md) · [第三轮 B：仍不通过](audit/assessment-b-round3.md) · [第三轮颜色实测](audit/color-check-round3.md)
- [第一轮 A](audit/assessment-a-round1.md) · [第一轮 B](audit/assessment-b-round1.md) · [第二轮 A](audit/assessment-a-round2.md) · [第二轮 B](audit/assessment-b-round2.md)

临时 QA 服务已停止（原创建 agent 确认退出码 130、4289 无监听），自建浏览器页已关闭，视口 override 已恢复；临时挂载目录已删除。

审查报告按原始内容归档，仅将已归档的临时证据路径调整到本目录。临时计算器和 QA 服务不是 Canvas 运行依赖。
