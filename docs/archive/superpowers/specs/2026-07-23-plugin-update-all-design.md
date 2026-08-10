# 插件「全部更新」设计

> 日期：2026-07-23  
> 状态：**待实现**  
> 范围：设置 → 插件管理中，官方受管插件的批量更新入口  
> 相关：[`2026-07-07-managed-external-plugins-and-codex-migration-design.md`](./2026-07-07-managed-external-plugins-and-codex-migration-design.md)

## 1. 目标

有 **≥2** 个已安装官方插件可更新时，提供一键「全部更新」，避免逐行点「更新」。

### 1.1 完成标准

- [ ] 可更新数 ≥ 2 且允许官方变更时，顶栏出现「全部更新」
- [ ] 可更新数 < 2、workspace 模式、或 `officialMutationsAllowed === false` 时不出现
- [ ] 点击后串行调用现有 `plugin.update(id)`，失败不阻断后续
- [ ] 结束后给出可理解汇总（全成功 toast / 部分或全失败 `showAppAlert`）
- [ ] 批量进行中锁定相关 mutate 入口，避免交错操作与难读 toast
- [ ] 不新增主进程批量命令；不自动重启

### 1.2 边界

| 做 | 不做 |
| --- | --- |
| Renderer 编排批量更新 | `plugin.updateAll` 等新 IPC/命令 |
| 复用 `plugin.update` + 现有 `enqueue` 串行 | 并行下载/安装 |
| 顶栏批量入口 + 行内「更新」并存 | 把「检查更新」与「全部更新」合并 |
| 失败继续 + 结束汇总 | 自动「立即重启」 |
| i18n 中英文文案 | 改索引刷新策略（不在批量前强制 `checkUpdates`） |

---

## 2. 现状基线

| 能力 | 现状 |
| --- | --- |
| 检查更新 | 顶栏图标按钮 → `plugin.checkUpdates` → 刷新 catalog |
| 单插件更新 | 行内「更新」→ `plugin.update(id)` → loading/success toast；失败 `showAppAlert` |
| 主进程并发 | `install-service` 内 `enqueue`，更新本就串行 |
| 批量入口 | **无** |
| 重启 | `pendingRestart` 时顶栏「立即重启」 |

关键文件：

- `src/renderer/pages/settings/components/managed-plugins-section.tsx` — 顶栏动作、catalog
- `src/renderer/pages/settings/components/managed-plugin-rows.tsx` — 行内 update / `usePluginOp`
- `src/preload/plugin-management-api.ts` — `managedPlugins.update`
- `src/main/services/managed-plugins/install-service.ts` — `update` / `enqueue`
- `src/renderer/i18n/locales/{zh-CN,en}/settings-plugins.ts`

---

## 3. 产品规则（冻结）

### 3.1 可见性

```ts
const updatable = catalog.plugins.filter(
  (p) => p.installed && p.update != null && officialMutationsAllowed
);
const showUpdateAll = updatable.length >= 2;
```

- `officialMutationsAllowed` 来自 catalog（workspace 模式为 false）→ 与行内「更新」一致，整段隐藏。
- 仅 0 或 1 个可更新：不渲染批量按钮（单行「更新」足够）。
- 不采用「始终显示、无可更新时 disabled」。

### 3.2 布局

顶栏右侧现有簇：

```text
[ 立即重启? ] [ 全部更新? ] [ 检查更新图标 ]
```

- 「全部更新」：`Button` `size="sm"`，文案按钮（非纯图标），与「立即重启」同级密度。
- 「检查更新」保持 `size="icon-sm"` + tooltip。
- 有待重启与可批量更新可同时出现；批量完成后若出现 `pendingRestart`，用户仍点「立即重启」。

### 3.3 执行语义

1. 点击时 **快照** 当前 `updatable` 的 `{ id, name, version }[]`（按 catalog 稳定顺序，建议 id 字典序或现有列表序；实现选一种并单测锁定）。
2. 进入 `updatingAll` 状态；展示单个 loading toast：`正在更新插件…` 或带进度 `正在更新 {{current}}/{{total}}…`。
3. **串行** `await rejectFailedManagedPluginOperation(managedPlugins.update(id))`。
4. 单个失败：记入 `failures[]`，**继续** 下一个；不弹逐个失败 alert（避免连环打断）。
5. 整批结束后 **一次** `refresh()` catalog（中途不强制每步 refresh，减少列表抖动）。
6. 结束反馈：
   - 全成功：`toast.success`「已更新 {{count}} 个插件」（替换 loading toast id）
   - 部分失败：dismiss loading → `showAppAlert`  
     - title：`部分插件未能更新`  
     - body：成功数摘要 + 失败列表（`名称：错误信息`，多行）
   - 全失败：`showAppAlert` title `无法更新插件`，body 为失败列表
7. **不**在批量路径自动 `app.relaunch`。

### 3.4 批量进行中的锁定

`updatingAll === true` 时禁用：

- 「全部更新」自身
- 「检查更新」
- 所有行的 install / update / uninstall / rollback
- managed enable/disable 切换（与现有 `pendingManagedId` 同类互斥；可用统一 `mutationsLocked`）

内置插件 enable/disable 与官方包 mutate 无共享队列，**可不锁**；若实现更简单则一并 disable 亦可，优先最小锁官方 mutate。

### 3.5 与单行更新关系

- 非批量时：行内「更新」行为不变（仍用 `usePluginOp` 逐条 toast）。
- 批量时：不走 `usePluginOp` 的逐条 success toast，只走批量汇总，避免 N 条成功噪声。

---

## 4. 实现落点

### 4.1 编排位置

**Renderer only**，优先放在 `ManagedPluginsSection`（或抽到同目录小 hook `useUpdateAllPlugins`，避免 section 文件再涨破 size cap）。

不改：

- `plugin-commands` / permissions
- `install-service.update` 签名
- preload API（继续 `update(id)`）

### 4.2 状态

```ts
type UpdateAllFailure = { id: string; name: string; message: string };

// section 级
const [updatingAll, setUpdatingAll] = useState(false);
// 可选：把 updatingAll 经 props/context 传给 row actions 以 disable
```

快照与结果仅在一次点击的 async 闭包内，不必进全局 store。

### 4.3 文案（i18n）

`settings-plugins` 增补（中 / 英同步）：

| Key | zh-CN | en |
| --- | --- | --- |
| `action.updateAll` | 全部更新 | Update All |
| `toast.updatingAll` | 正在更新插件… | Updating plugins… |
| `toast.updatingAllProgress` | 正在更新 {{current}}/{{total}}… | Updating {{current}}/{{total}}… |
| `toast.updatedAll` | 已更新 {{count}} 个插件 | Updated {{count}} plugins |
| `toast.updateAllPartialTitle` | 部分插件未能更新 | Some plugins couldn't be updated |
| `toast.updateAllFailedTitle` | 无法更新插件 | Couldn't update plugins |

Alert body 可用轻量拼接（成功摘要 + 失败行），不必上复杂 markdown。失败行优先插件展示名，不暴露内部 id 作主文案（id 可作次要或省略）。

进度 toast：若 `toast.loading` 支持同 id 更新，则每步更新 `updatingAllProgress`；否则固定 `updatingAll` 亦可（验收不强制进度数字）。

### 4.4 错误与反馈纪律

对齐 AGENTS.md 操作反馈规范：

- 成功且无细节 → `toast.success`
- 带多行/技术细节失败 → `showAppAlert`，**禁止** `toast.error(..., { description })`
- 批量中不 `console.error` 代替用户可见反馈

### 4.5 文件改动预期

| 文件 | 变更 |
| --- | --- |
| `managed-plugins-section.tsx` | 顶栏按钮、批量 handler、`updatingAll` |
| `managed-plugin-rows.tsx` | 接收 `mutationsLocked` / `updatingAll`，禁用动作 |
| `settings-plugins.ts`（en + zh-CN） | 上表 keys |
| `managed-plugins-section.test.tsx`（及必要时 rows 测） | 可见性与汇总行为 |

---

## 5. 测试

### 5.1 组件/单元

1. **可见性**：2 个 `installed + update` → 有「全部更新」；1 个 → 无；0 个 → 无。  
2. **门控**：`officialMutationsAllowed: false` → 无。  
3. **成功路径**：mock `update` 两次 resolve → 一次 `toast.success`（`updatedAll`），`update` 调用顺序与快照一致。  
4. **部分失败**：第一次 reject、第二次 resolve → `showAppAlert` partial title，body 含失败名；两次均被调用。  
5. **全失败**：均 reject → failed title alert。  
6. **进行中锁定**：`updatingAll` 时检查更新按钮与行内更新 disabled（或不可点）。  
7. **空 API**：无 `managedPlugins` 时点击 no-op / 不抛。

### 5.2 不必做

- 主进程 install-service 新单测（无新后端行为）
- E2E 真下载

---

## 6. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 批量中 catalog 被别处刷新导致列表闪动 | 整批结束再 `refresh`；按钮用点击瞬间快照 |
| 串行较慢 | 可接受；官方插件数量通常很少；进度 toast 缓解 |
| 与单行 toast 风格不一致 | 有意：批量用汇总，单行保持细粒度 |
| section 文件体积 | 超 cap 则抽 `use-update-all-plugins.ts` 或 handler 纯函数 |

### 否决方案（已讨论）

- **≥1 就显示全部更新**：与单行重复，已否。  
- **遇错即停**：已否，改为失败继续。  
- **新增 `plugin.updateAll`**：当前无 CLI/多客户端需求，已否。  
- **批量前强制 checkUpdates**：与顶栏检查职责重叠、增加等待，已否。

---

## 7. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 显示阈值 | ≥2 | 避免与单行「更新」重复 |
| 失败策略 | 继续 + 结束汇总 | 扩展市场常见；不因一个失败堵死其余 |
| 实现层 | Renderer 循环 `plugin.update` | 零契约膨胀；复用 enqueue |
| 批量中锁 mutate | 是 | 防止交错 toast 与重复点击 |
| 自动重启 | 否 | 沿用现有「立即重启」心智 |

---

## 8. 下一步

1. 本 spec 确认后 → 写 `docs/archive/superpowers/plans/2026-07-23-plugin-update-all.md`。  
2. 按计划改 UI + i18n + 测试并验收 §1.1。
