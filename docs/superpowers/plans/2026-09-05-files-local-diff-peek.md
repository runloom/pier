# Files 局部变更预览实施计划

状态：已实施并验证（2026-09-05）。比较语义：HEAD → 当前文档，包含未保存编辑。

## 产品契约

- 源码与 Markdown 左侧色条单击打开只读局部预览；同一色条再次点击关闭，切换色条替换内容。每个 Files 面板至多一个预览。
- hover 只增强色条并延迟 400ms 提示；命中区域 16px，色条 3px / hover 5px，删除采用短横线。不得侵占评论和行号。
- 源码使用 CodeMirror block widget；Markdown 使用非模态浮层，展示源码文本 diff。共享渲染器包含完整连续修改及前后各三行、真实行号、行内高亮、换行。正文高度不超过 min(320px, 视口 45%)；大块虚拟化。
- 单行工具栏提供比较基线、完整审查、关闭；多处修改时才显示修改数与上一处、下一处。键盘入口走 Files 命令，Alt+F5 / Alt+Shift+F5 导航，不循环、不影响终端。键盘打开聚焦工具栏，Esc 返回原正文；鼠标操作保留编辑选择。
- Markdown 色条使用稳定 range ID；删除使用后继块/文末锚点，无可见块时仍可通过文档工具栏访问。保持正文、评论、大纲的共享几何。
- 文件、模式、面板、内容版本、HEAD 版本变化，正文点击、宿主对话框打开时关闭旧预览。旧内容不可悄悄替换。
- 预览只读，不做暂存/回退；完整审查复用现有入口。未保存时说明完整审查只包含已保存内容，无磁盘变化则提示先保存，不自动保存；定位只使用已验证的磁盘行。

## 数据与生命周期

- 新增窄接口 git.getFileBaseline({root,path})，只读 HEAD blob；输出 ready / unavailable / error。ready 包含 gitRoot、path、basePath、headOid、contents、existsAtHead。先固定 OID，再读取 blob；身份改变重试一次；只有明确缺失/无 HEAD 使用空基线。复用 Git 服务和编码校验，10MiB 上限，git:read 权限。
- 每文档共享引用计数资源：FilesDocument.currentContents 是当前侧唯一真源；源码 gutter、minimap、Markdown、计数和 peek 使用同一版本快照。HEAD/path 不变时复用基线；watch 按 root 共享。实例打开状态各自独立。
- 使用已安装 @pierre/diffs，在独立 Worker 比较；不新增 LCS 或算法依赖。150ms 防抖，IME 延迟、过期结果丢弃；编辑期间映射旧装饰并禁止打开失效 range。
- 自动计算限制双方各 2MiB / 50k 行、2 秒；上限内大文件按需 5 秒，超时终止 Worker并提供重试。无主线程重算退路。
- PierDiffExcerpt 位于 packages/ui/src/diff-view，保持 readonly、复用主题与 Worker。CodeMirror widget 通过 React portal 保持宿主 Provider。

## 实施任务

1. 基线协议、Git 服务、IPC/preload、builtin/external facade 与真实仓库测试。
2. 共享差异 Worker、文档资源、版本与资源释放测试。
3. 共享 excerpt、源码 block widget、Markdown 浮层、工具栏和命令、四语文案。
4. 交互与生命周期回归；更新 AGENTS 与历史规格，执行静态/单元/组件/集成和可用 E2E。

## 验证

- 空仓库、新文件、rename、删除、Unicode/EOL、读错/权限/二进制/超大文件；失败不可显示为新增。
- 未保存编辑实时更新，保存/暂存不改变差异语义；多实例共享、过期结果不覆盖、最后消费者释放 watch/Worker。
- source/Markdown 切换、同色条 toggle、删除/空正文、懒分页、窄面板、键盘/IME/焦点、正文和对话框关闭。
- 完整审查准确区分已保存与未保存；四语、明暗主题、架构/尺寸/文案治理。
- 性能基准 10k 行 / 500KiB / 30 处变化：缓存打开 p95 ≤100ms，空闲后更新 p95 ≤500ms；只有实测后报告性能结论。

不提交、暂存或推送代码；保留可审阅工作树。

## 第二轮整体 UI 优化

用户确认在保留点击和完整差异内容的基础上，统一 Files 编辑与 Markdown 预览的视觉密度及空间边界。

1. 正文与预览共用右侧留白：16px，小于 520px 的窄面板为 12px；计入正文左 padding、gutter、minimap 和滚动条。横向滚动时预览保持在可见代码栏内，尺寸变化不重建 portal。
2. 单层边框、小圆角、弱分隔线、单行工具栏与 28px 控件。仅多处修改显示导航；未保存采用短标签，详细比较范围保留在说明与无障碍描述中。
3. 源码和差异共用代码字体、字号与行高。原生 CodeView 测量正文和上下留白，短段落自然收紧，长段落沿用虚拟滚动；高度变化同步 CodeMirror heightmap，保留 DOM 和光标。
4. 真实 Electron 全面板截图和几何断言：明暗主题、长链接新增、窄面板、水平滚动、minimap 开关、字号变化、行号对齐、大段差异末行可达。Markdown 保留既有大纲与评论布局。

## 第一轮完成记录

四项实施任务均已完成。源码与 Markdown 共用文档差异资源与只读 excerpt，旧点击导航和独立 Markdown 计算路径已移除；基线契约贯通 main、preload、builtin / external 插件 API，并同步四语文案与治理规格。

| 验证 | 结果 |
| --- | --- |
| `pnpm check:static` | 通过：类型、格式、架构、文件尺寸与目录密度 |
| `pnpm test:unit --maxWorkers=4` | 1,535 个文件、13,354 项通过；1 个文件、2 项跳过 |
| `pnpm test:component --maxWorkers=4` | 42 个文件、587 项通过 |
| `pnpm test:integration` | 6 个文件、53 项通过 |
| `pnpm test:e2e:auto --remote tests/e2e/files/local-diff-peek.spec.ts` | 真实 Electron 通过；深色源码 / Markdown、浅色窄面板、光标保持与命令入口焦点 |
| 10k 行 / 约 500KiB / 30 处修改 | 缓存打开 P95 20.1ms，输入更新 P95 250.4ms；详见[规格实测记录](../specs/2026-09-05-files-local-diff-peek-design.md#2026-09-05-性能实测) |

审查中补齐了 Git replacement refs 与基线缓存一致性、编辑器卸载时清除临时 widget、Markdown 懒分页删除锚点、比较中的导航请求、命令面板退出后的焦点交接。均有回归覆盖，最终定向复核未发现残留问题。`git diff --check` 通过，暂存区保持为空。

## 第二轮 UI 优化完成记录

四项 UI 优化均已完成。源码预览与 minimap 保持 16px 间隔，窄面板为 12px；调整面板、字号、minimap 和横向滚动时仍保持可见边界。源码与 Markdown 共用单行工具栏和正文样式，各自只保留一层外框。短差异按实际内容收紧，长差异在预览内独立滚动，完整末行可达，滚动到边界不会带动外层源码。

原生 CodeView 的布局留白与正文度量已对齐；实际 widget 高度同步 CodeMirror heightmap，更新尺寸时保留 portal DOM，避免后续行号错位。保留完整新增内容、只读选择、原有点击和键盘行为。

| 本轮验证 | 结果 |
| --- | --- |
| 静态检查 | `pnpm check:static` 通过；最终调整后相关类型、格式与边界检查通过 |
| 相关单元测试 | 30 个文件、188 项通过；最终定向复核 3 个文件、13 项通过（包含在相关覆盖范围内） |
| 全量组件测试 | 42 个文件、587 项通过 |
| 真实 Electron 回归 | 源码 / Markdown、明暗主题、宽窄面板、字号、minimap、水平滚动、行号对齐、长差异末行及外层滚动保持通过 |
| 视觉复核 | 完整面板截图复核单层边框、工具栏密度、短内容留白和缩略图间隔；截图禁用过渡动画，避免捕获中间帧 |

本轮沿用远端 runner 构建的产品快照 `c0b367186026`，最终截图断言调整后使用同一构建重新运行 Electron 测试；产品文件与本地工作树逐一核对一致。第一轮全量单元、集成与性能数字为历史记录，本轮未重复宣称性能实测。所有改动保留在工作树，不暂存、提交或推送。
