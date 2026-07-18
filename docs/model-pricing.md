# 模型定价目录

Pier 宿主在 `src/main/services/usage-data/pricing-catalog.json` 集中持有 API 等价成本估算的费率表。数据采集插件（如 `pier.codex`）只负责发布原始 token 观测（`UsageDataPublishInput`），宿主统一把 token → 金额，避免各插件产生不可聚合的金额口径。

## 目录结构

```json
{
  "models": {
    "<model-id>": {
      "inputMicrousd": 1.25,
      "cachedInputMicrousd": 0.125,
      "outputMicrousd": 10,
      "aliases": ["<pattern>", "<pattern>-*"],
      "longContext": {
        "threshold": 200000,
        "inputMicrousd": 2.5,
        "cachedInputMicrousd": 0.625,
        "outputMicrousd": 15
      },
      "priority": {
        "inputMicrousd": 10,
        "cachedInputMicrousd": 1,
        "outputMicrousd": 60
      }
    }
  }
}
```

- 单位是每 token 微美元（USD/token × 1_000_000）。厂商公开定价常以 USD/M（USD/百万 token）表示，两者数值相同（除以 1 即可直接放进 `inputMicrousd`）。
- `longContext.threshold` 按**单次观测的输入 token 数**触发，不是每日累计。
- `priority` 走 `observation.serviceTier === "priority"` 分支。
- `cachedInputMicrousd` 仅在 `observation.cachedInputTokens > 0` 时按 clamp 后的 cached 数量计价，非 cached 走 `inputMicrousd`。

## 别名匹配

`resolvePricing` 顺序：

1. `normalizedModelId` 去掉尾部 `-latest` 和 `-YYYY-MM-DD` 日期后精确匹配。
2. 别名列表精确匹配。
3. 别名列表的最长前缀通配匹配（`foo-*` 视为 `foo-` 前缀）。
4. 都未命中返回 `null`，观测被记为 `unpriced`。

## 当前覆盖

170+ canonical 模型，涵盖：

- **OpenAI**：GPT-5 / 5.1 / 5.2 / 5.3 / 5.4 / 5.5 / 5.6 系列 + Codex / mini / nano / pro 变体 + o1 / o3 / o4-mini + realtime / search / audio preview 分支（含长上下文与 priority 档）。
- **Anthropic**：Claude Haiku / Sonnet / Opus 3.5、4.x、5.x 全系；Sonnet 200k 长上下文档。
- **Google**：Gemini 2.5 Pro / Flash / Flash-Lite / native-audio 与 Gemini 3 / 3.1 系列，Pro 走 200k 长上下文档。
- **xAI**：Grok 4 / 4.3 / 4.5 / 4.x fast、Grok Code（LiteLLM `xai/*` 经 `UNPREFIX_MAP` 归一）。
- **DeepSeek**：deepseek-chat / reasoner / coder / R1 / V3 / V3.2 / V4-flash / V4-pro。
- **Moonshot / Kimi**：kimi-k2 系列（k2 / k2.5 / k2.6 / turbo / thinking），moonshot-v1 8k/32k/128k（含 vision preview）。
- **Alibaba Qwen**：qwen-max / plus / turbo / coder，qwen3-next 系列，qwen3-vl 全系（235B、32B 的 instruct/thinking 变体）。
- **Zhipu GLM**：glm-4.5 / 4.5-air / 4.5-airx / 4.5-x / 4.5v / 4.6 / 4.7 / 4.7-flash / 5 / 5-code / 5.1。
- **MiniMax**：MiniMax-M2 / M2.1 / M2.5 / M3（含 lightning 分档）。
- **Baichuan**：baichuan-m2-32b（M2 系列）。

**尚未 LiteLLM 覆盖的厂商**（暂时按 unpriced 处理，等 LiteLLM 上游或人工补充）：

- **ByteDance Doubao**：LiteLLM 有 `volcengine/doubao-seed-*` 条目但未标价。用户使用时会显示为 `unpriced` bucket；从 [Volcengine 官方定价](https://www.volcengine.com/product/doubao) 手工录入可解锁计价。
- **01.AI Yi**：LiteLLM 无条目；从 [01.AI 官方定价](https://platform.lingyiwanwu.com/docs) 手工录入。

需要覆盖时，直接在 `pricing-catalog.json` 里手工加条目，`update-model-pricing.mjs` 保留手工字段（`aliases` / `priority` / 未在 LiteLLM 出现的条目）。

## 自动更新流程

**每天 UTC 03:00**，`.github/workflows/update-model-pricing.yml` cron 触发（也可 `workflow_dispatch` 手动跑）：

1. 拉 [LiteLLM canonical JSON](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)（3000+ 条目）
2. 拉 [OpenRouter `/v1/models`](https://openrouter.ai/api/v1/models)（补 alias + fill-missing）
3. 归一化：LiteLLM 的 `provider/model` 前缀 → canonical id，`-latest` / `-YYYY-MM-DD` 后缀由 runtime 剥离
4. 过滤：只保留 `mode: "chat"` 且不在 `SKIP_PREFIXES`（`bedrock/` / `azure/` / `openrouter/` 等 duplicate 提供商）的条目
5. 单价 USD/token × 10^6 = microusd/token
6. 与当前 `pricing-catalog.json` diff，生成 `pricing-diff.md`：涨/跌/新增
7. **无 diff → 直接结束**（不装依赖、不跑测试、不 commit、不开 PR）
8. **有 diff →** 跑 schema/pricing 护栏测试，再开/更新 PR（title `chore(pricing): daily LiteLLM refresh`），reviewer 检查后 merge
9. PR 里的 `pricing-diff.md` 单独列出**可疑变化**（>= 5x 涨或 <= 20% 跌），提醒 reviewer 二次核对

**手动触发**：`gh workflow run update-model-pricing.yml` 或 GitHub UI 里 "Run workflow"。

**本地跑**：

```bash
node scripts/update-model-pricing.mjs                             # 写入并生成 diff 打印到 stderr
node scripts/update-model-pricing.mjs --dry                       # 只打印 diff 不写盘
node scripts/update-model-pricing.mjs --diff-out=/tmp/diff.md     # diff 同时写文件
```

## 合并策略（脚本行为）

- **覆盖字段**：`inputMicrousd` / `cachedInputMicrousd` / `outputMicrousd` / `longContext` — LiteLLM 是权威源。
- **保留字段**：
  - `aliases` — 手工补充的匹配模式（如 `claude-sonnet-4-5-*`）在 merge 时保留
  - `priority` — LiteLLM 无 priority 概念，只在手工目录里维护
  - `longContext.priority`（如果有）
- **保留条目**：LiteLLM 未覆盖的 canonical id（如 speculative 未来模型、Doubao 手工录入）**不会被移除**，除非 reviewer 在 PR 里手工删。
- **不保留**：dated 后缀键（`gpt-4o-2024-05-13`）—— canonical id 已覆盖，且 runtime 归一后会命中 canonical。

## 校验测试

`tests/unit/main/pricing-catalog-schema.test.ts` 是生成物的护栏，PR 里的 CI 会跑：

- 每条 entry 有非负 input/output/cachedInput 三个数值
- `cachedInputMicrousd <= inputMicrousd`（防 LiteLLM 上游 typo 把 cache 标高于原价）
- `longContext` / `priority` 分档字段完整
- key 不带会被 `normalizedModelId` 剥离的后缀（`-latest` / 日期）
- catalog 至少 100 条 + 关键 canonical id（`gpt-5` / `claude-sonnet-4-5` / `gemini-2.5-pro` / `deepseek-chat` / `grok-4`）都在

大幅涨跌（≥5x 涨 或 ≤20% 跌）不阻塞 PR，只在 diff 报告里显式标注 ⚠️ 让 reviewer 优先看。

## 数据源

| 源 | 用途 | 更新频率 | 覆盖 |
|---|---|---|---|
| [LiteLLM canonical JSON](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) | 主要单价来源；`xai/` 等 vendor 前缀剥成 canonical id | 社区共建，日多次 | 3000+ entries |
| [OpenRouter `/v1/models`](https://openrouter.ai/api/v1/models) | ① 给已有 canonical 补 `provider/id` alias；② LiteLLM 未入库时 fill-missing 建条目 | 实时 | 200+ entries |
| 厂商官方定价页 | 冲突仲裁 fallback | 变化时手工 | 全部 |

冲突仲裁：LiteLLM 与 OpenRouter 差异 → 以厂商官方为准；OR fill-missing 不覆盖已有 LiteLLM 价，可疑涨跌进 diff 的 Suspicious 段。
