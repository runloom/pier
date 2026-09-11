# 操作反馈规范 — 金标准

日期：2026-09-09
状态：已确认。本文是用户动作反馈方式的唯一权威细则；AGENTS.md「操作反馈规范」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

所有用户触发的动作必须有可识别的完成或失败信号，静默失败（`catch (err) { console.error(...) }` 就结束）一律禁止。选择反馈方式时按以下顺序判断，防止漏报也防止重复：

- **后台/系统事件（非用户动作触发）一律经 `systemNotify()`**（`src/renderer/lib/notifications/system-notify.ts`）：上报 NCS 落档；打断由 main `resolveDeliveryPlan` 统一调度——**有 Pier key-window → 形态 B 单窗 toast**（`NOTIFICATION_CENTER_MESSAGE_TOAST`）；**无 key-window 且 kind 在 OS 白名单 → 系统通知**。禁止 renderer 订阅快照后自弹、禁止裸 `toast.*` 发系统事件、禁止业务直调 OS API。只落档不打扰时传 `suppressToast: true`。记录去重用 `dedupeKey`（NCS 统一合并）。多窗：inbox 全窗同步；消息 toast / OS / 声音进程级各一次（见 `docs/superpowers/specs/2026-08-02-notification-focus-routed-delivery-design.md`）。
- 已经有**强自然 UI 反馈**（列表新增/删除、导航切换、Modal 关闭、面板打开、表单值即时更新等）→ **不再加 toast**；重复反馈是噪声。
- 只有**弱 UI 反馈**（Save 按钮从 enabled → disabled、dirty 位清零等）或**完全无 UI 反馈**（写盘、无 refetch 的写请求、后台任务触发） → 成功走 `toast.success(t("..."))`。
- 短失败（用户能从 title 理解、无技术详情）→ `toast.error(t("...Failed"))`。
- 带技术详情的失败（`Error.message`、IPC 错误串、多行说明）→ **直接** `showAppAlert({ title: t("...Failed"), body: err instanceof Error ? err.message : String(err) })`，禁止 `toast.*(…, { description })`。`console.error` 不面向用户，只能作为额外日志。唯一例外：消息型 toast（形态 B）的详情槽位是契约一部分，唯一实现 `show-notification-toast.tsx`（治理测试锁定），其余调用点仍禁 description。
- Toast 复用 `sonner`（胶囊短 title；可选 action 如撤销）；宿主代码从 `sonner` 直接 `import { toast }`，插件走 `context.notifications.{success,error}`；文案必须走 i18n key，禁止内联字符串。

**代码审查检查点**：
- 每个 `onClick` / `onSubmit` / async mutation 都要能回答"用户怎么知道刚才发生了什么"。答不出 → finding。
- 遇到 `catch` 里只有 `console.error` / `console.warn` 而没有 `toast.error` / `showAppAlert` → finding，除非注释里明确说明不面向用户的路径（如启动阶段 boot log）。
- 遇到"有明显 UI 变化 + 又加了 toast"的双反馈 → minor finding，建议删掉冗余 toast。
- 遇到内联 toast 文案字符串（未走 i18n） → finding。
- 遇到 `toast.*(…, { description })` → finding，详情应走 `showAppAlert`（`show-notification-toast.tsx` 的形态 B 详情槽位除外）。
