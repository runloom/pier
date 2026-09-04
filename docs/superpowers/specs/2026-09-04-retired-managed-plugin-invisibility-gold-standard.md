# 退役官方插件彻底不可见

日期：2026-09-04  
状态：现行权威  
范围：官方受管理插件改名或折入宿主之后的旧 id 在产品里如何消失。  
不包含：内置插件的启用/禁用、dev override、第三方插件（本来就不开放）。

相关：受管理插件安装底座见 [`AGENTS.md`](../../../AGENTS.md)「Managed 官方外部插件模块」；分屏能力本身仍以 [`2026-08-17-tmux-compat-native-splits-design.md`](./2026-08-17-tmux-compat-native-splits-design.md) 为准（现行 id `pier.agent-splits`）。  
权威实现：[`retired-plugins.ts`](../../../src/main/services/managed-plugins/retired-plugins.ts)、[`catalog-operations.ts`](../../../src/main/services/managed-plugins/catalog-operations.ts)、[`install-operations.ts`](../../../src/main/services/managed-plugins/install-operations.ts)、[`install-boot.ts`](../../../src/main/services/managed-plugins/install-boot.ts)、[`scripts/generate-plugin-index.mjs`](../../../scripts/generate-plugin-index.mjs)。  
检查点：`tests/unit/main/plugins/retired-plugin-invisibility-governance.test.ts`。

---

## 一句话终态

退役的官方插件在产品里**彻底不可见**：签名官方索引不卖、设置「已安装 / 未安装」不出现、不能安装。宿主退役表只挡住旧缓存索引，不是让旧 id 继续挂在目录里。

---

## 决策树

1. **能力还在，只是改名**（`pier.tmux` → `pier.agent-splits`）→ 旧 id 退役；新 id 是唯一目录行。
2. **能力折进宿主**（语言包 → Files / L0 PATH）→ 旧 id 退役；宿主内建承担。
3. **仍在卖的官方插件** → 不进退役表。

改名不做 `replacedBy` 持久迁移机。安装基数极小，一次性从 install index 清掉足够。

---

## 可见性单源

| 层 | 规则 |
|---|---|
| `RETIRED_MANAGED_PLUGIN_IDS` | 宿主真源：boot 清 install index、catalog 三路过滤、install 拒绝 |
| 签名 `plugins/index.v1.json` | 发现面真源：**不得含**退役 id。`generate-plugin-index` 合并历史条目或误打的本地 pack 时必须丢弃 |
| 设置已安装 / 未安装、`plugin.catalog.list` | 只消费 catalog snapshot，不再自己滤一遍 |
| GitHub 历史 tgz | 可留（不可变资产）；索引不再指向即不可发现 |

宿主退役表是防御：用户磁盘上仍缓存着带旧 id 的索引时，产品也不得把它画出来。防御不能替代把旧 id 移出下一份签名索引。

---

## 明确不做

- 目录里留一行「已退役」灰名或卸载残留
- 旧 id 与新 id **双卖**（同一说明、两个名字）
- 设置页自己滤、官方索引继续挂
- `replacedBy` 状态机、自动把旧包装成新包
- 为「彻底不可见」去删已经发布的 GitHub tgz

---

## `pier.tmux`

2026-08-25 更名为 `pier.agent-splits`（产品名：智能体分屏）。`pier.tmux` / 「工作台分屏」是退役 id，不是第二个分屏插件。
