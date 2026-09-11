# 弹窗系统 — 金标准

日期：2026-09-09
状态：已确认。本文是宿主与插件弹窗（简单弹窗、content dialog、弹窗表单、浮层后打开）的唯一权威细则；AGENTS.md「宿主弹窗使用规范」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

## 简单弹窗（宿主弹窗使用规范）

宿主级确认/提示弹窗统一走 `src/renderer/components/common/dialogs/host.tsx`：

- 业务代码不要直接 import `@pier/ui/alert-dialog.tsx`；宿主 renderer 使用 `showAppConfirm` / `showAppAlert` / `showAppChoice` / `showAppPrompt`，插件使用 `RendererPluginContext.dialogs` / `ExternalRendererPluginContext.dialogs`。
- builtin 与 external 插件的简单弹窗 API **同构**：`alert` / `confirm` / `choice` / `prompt`；复杂内容另加 `open` / `update` / `close`。
- 布局（路线 B：桌面工具对话框；macOS 优先，全平台同一套壳）：
  - 文案一律左齐；宽度只由 kind 决定，不再切换居中营销卡
  - 密度：`p-5` + `gap-4`、标题 `text-base`、footer **右簇**（禁止 sm 两列等宽铺满）
  - destructive `confirm`：侧标必须用共享 `@pier/ui/status-icon`（与 toast / Alert 同套，`kind="error"`），禁止手写 Lucide 大圆/方底
  - `choice` / 普通 confirm / prompt：**无**侧标；危险只靠按钮色
  - `alert`：单主按钮（右簇）
  - `confirm` / `prompt`：`取消 | 主按钮`（主按钮最右）
  - `choice`：`alt | 取消 | confirm`（例：不保存 | 取消 | 保存）；横排三键
- **`size` 禁止调用方传入**（宿主 `appDialogSizeForKind` / 插件 facade 同构强制）：
  - `alert` / `confirm` / `prompt` → 固定 `sm`
  - `choice` → 固定 `default`（三键横排）
  - 业务与插件 API **不接受** `size` 字段；更长内容走 content dialog（`openAppContentDialog` / `dialogs.open`），不要用宽 confirm 硬塞说明
  - 禁止回退为「每个确认各自传 sm/default」
- `intent`：调用方必填，不要在 `AppDialogHost` 里按标题或文案猜测危险程度
  - 破坏性确认必须显式传 `intent: "destructive"`，普通确认显式传 `intent: "default"`
  - `confirm` / `prompt`：作用在**主按钮**
  - `choice`：作用在 **alt**（不保存/丢弃）；confirm 始终 default 样式
  - 若破坏动作落在 `choice.confirm`（如覆盖），`intent` 仍必须 `"default"`，不能为了“看起来危险”去染 alt
- 取消按钮一律 `outline`（含 destructive 场景）；Esc / 点遮罩 = 取消
- 检查点在 `tests/unit/renderer/notifications/app-dialog-governance.test.ts` 与 `tests/component/app/dialog-host.test.tsx`

复杂内容弹窗（表单、多步、等待态、带自定义 body）统一走宿主 `AppContentDialogHost`：

- 宿主业务使用 `openAppContentDialog` / `updateAppContentDialog` / `closeAppContentDialog`；插件使用 `context.dialogs.open` / `update` / `close`（不要再挂自己的 `@pier/ui/dialog` 产品壳）。
- 插件 renderer 禁止 import `@pier/ui/dialog` 或 `@pier/ui/alert-dialog`；嵌套插件 Dialog（Settings 内再开插件 Dialog）一律禁止。
- **决策树**（必须按此选型，禁止“图省事全走 content dialog”）：
  1. 短成功 / 弱反馈 → toast
  2. 只告知、无决策 → `alert`（固定 `sm`）
  3. 取消 | 确认 → `confirm`（固定 `sm`）
  4. alt | 取消 | 确认 → `choice`（固定 `default`）
  5. 单行输入 + 校验 → `prompt`（固定 `sm`）
  6. 多控件 / 多步 / 等待态 / 结构化结果 → `dialogs.open`（content dialog）
  7. 全页产品壳（设置、物料库）→ 宿主自有 `Dialog`（非插件）
- **无自定义控件的纯确认/提示，禁止塞进 content dialog**（含“title/description + 两个按钮”）。
- 短确认/破坏性确认仍走 `dialogs.confirm` / `showAppConfirm`。
- 模态层级约定：content dialog 栈 > `AppDialogHost` 单槽 > Settings 等宿主产品壳；`AppDialogHost` 新请求会顶替未决简单弹窗，content 栈独立。
- `context.overlays` **已删除**：历史“插件自挂 Dialog 壳”通道不再存在；新代码与存量一律 `dialogs.open`。
- 检查点在 `tests/unit/renderer/plugin-product-dialog-governance.test.ts` 与 content dialog 单测。

## 弹窗表单规范（交互 + 字段布局，禁止再发明第三套）

弹窗里一旦出现输入控件，只允许下列两种交互模型；壳、footer、字段方向都由模型决定。共享 class 单一来源：`packages/ui/src/dialog-form-layout.ts`（`@pier/ui/dialog-form-layout.ts`）。

| 模型 | 何时用 | 壳 | 字段方向 | Footer | 保存时机 |
|------|--------|----|----------|--------|----------|
| **提交型（commit form）** | 创建/写入/有草稿可取消（新建 worktree、建 skill、SSH host、账号添加主路径） | `AppContentDialogHost` / `dialogs.open` | **垂直** `Field`（Label → 全宽控件 → Description/Error；`DIALOG_COMMIT_FORM_CLASS` + `DIALOG_COMMIT_FIELD_GROUP_CLASS`） | **必须** `setFooter` / `useContentDialogFooter`：右簇 `取消 \| 主按钮`（`DIALOG_FOOTER_ACTIONS_CLASS`）；宿主可复用 `ContentDialogFooterActions` | 点主按钮才提交；取消/ Esc 丢弃草稿 |
| **即时偏好（live preference）** | 改了即生效、无独立「保存」语义 | **设置页** 内：水平 `*Row`（密度）；content dialog 内若有即时偏好，字段布局 **与提交型相同**（垂直 Label → 全宽控件） | 用 `DIALOG_COMMIT_FORM_CLASS`；**禁止** 再套 Card/`rounded-xl border` 表单壳；禁止左标签右窄控件的「设置行」伪装 dialog 表单 | **默认无「保存」footer**；关窗用 Header X | `onChange` 即时写 |

硬规则：

1. **禁止 body 内仿 footer**：content dialog 的取消/主按钮不得写在滚动 body 底部（`flex justify-end` 一排冒充 footer）；一律 `setFooter`，由宿主 sticky `DialogFooter` 承载。行内次要动作（列表「添加」、授权「打开浏览器」）除外。
2. **禁止嵌套产品壳**：Dialog body 内不得再挂 `@pier/ui/dialog` / `Card` 当表单分区；分区用 `FieldSet` + `FieldLegend` 或扁平 `DIALOG_SECTION_TITLE_CLASS`（对齐 skill 详情）。
3. **控件密度**：弹窗表单主路径 Select / Input / Button 用默认 28px 密度；**禁止**为「显得紧凑」给主表单 `SelectTrigger size="sm"` / footer `Button size="sm"`。列表内图标排序等次要 hit 可用 `icon-xs`。
4. **设置页即时偏好**：设置页内水平 `*Row`；若在 content dialog 里做即时偏好，字段布局必须与提交型 dialog 一致（垂直堆叠、全宽 Select/Input，参考 worktree）。不得自挂 Dialog，不得用设置页水平 `SelectRow` 样式塞进 content dialog。多实例列表用 `Item outline` 表达块边界。**添加/创建类草稿** 走 **二级 content dialog**（`openAppContentDialog` + sticky `取消|确认`）。
5. **校验**：提交型在 submit 时校验并用 `FieldError`；`prompt` 走 `validate`。即时偏好以合法枚举/开关为主，避免半填草稿。
6. **提交型 dialog 的可选勾选 / 开关默认值（禁止第三套「记住上次」）**：先判定字段性质；禁止 dialog host 或通用 `rememberDialogField`。
   - **情境决策**（跟这次 status / 候选 / 远程资格绑定）：每次从当前快照推导；取消与 Esc 丢弃；禁止 `localStorage` / 上次勾选。例：git 确认提交的「包含未暂存」；SSH 导入勾选主机；账号切换同步到其他工具。dialog 里对设置初值的**这一次改动**（如关掉「提交后推送」）同样不回写。
   - **稳定工作流习惯**（同一人反复同一套，且与这次快照无关）：仅允许该表面旁的小模块，**显式切换即写**（取消窗不清缓存；也不靠提交才写）。例：新建工作树的命名方式 / 立即开始任务。不得把草稿（说明、名称、路径）一并记住。
   - **能在设置里叫出名字的**（提交后推送默认值、退出确认）：走设置页（宿主 `ProjectPreferences` 或插件 `configuration`）；dialog **只读初值**，勾选不回写。未做设置前用安全默认，禁止用粘滞勾选冒充。
   - 即时视图偏好仍走该表面已有 store（审查 diff、Markdown 阅读、侧栏收起），不经提交型 dialog 记忆层。
7. **检查点**：`tests/unit/renderer/app/dialog-form-governance.test.ts`（与本节标题绑定）。

## 浮层后打开 Dialog / 设置

从 DropdownMenu / ContextMenu / Select 等 Radix overlay 的菜单项打开 Dialog 或设置时，业务代码写普通 controlled state 即可：

- `@pier/ui/dialog` / `@pier/ui/alert-dialog` 对 controlled `open`：无 overlay 时同步打开；检测到菜单/select 仍在或 body `pointer-events: none` 时，内部等待 unlock 后再挂载。关闭始终同步。
- 若等待超时仍被锁，**放弃打开**（不强制挂载），避免 body 指针锁残留导致整页点不动；`open` 变回 `false` 会取消 pending。
- 打开设置继续走 `useSettingsDialogStore.open` / `openSection` 或插件 `context.app.openSettings`，不要在业务侧再套 `setTimeout` / `scheduleAfterOverlay` / `modal={false}`。
- 检查点在 `tests/unit/renderer/app/overlay-dialog-governance.test.tsx`、`tests/unit/renderer/app/use-deferred-dialog-open.test.tsx` 与 `tests/unit/renderer/app/schedule-after-overlay.test.ts`。
