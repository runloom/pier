#!/usr/bin/env node
// 从 LiteLLM canonical pricing JSON（可选交叉验证 OpenRouter）拉取每个 token 的
// 单价，归一化到 Pier 的 `pricing-catalog.json` shape（microusd/token）。
//
// 用法：
//   node scripts/update-model-pricing.mjs         # 覆写 pricing-catalog.json + 输出 diff
//   node scripts/update-model-pricing.mjs --dry   # 只输出 diff 不写盘
//   node scripts/update-model-pricing.mjs --diff-out=<path>  # 把 diff 也写入文件
//
// 合并语义：
//   - 保留本地手工维护字段：aliases、priority（LiteLLM 无 priority 概念）
//   - 覆写 inputMicrousd / cachedInputMicrousd / outputMicrousd / longContext
//   - LiteLLM 未覆盖的老 entry 保留（含 Pier speculative 未来模型）
//   - LiteLLM 新增模型追加进 models（provider 白名单内）
//
// 大幅涨跌保护：单个模型的 input / output 单价变化 > 5x 或跌 < 20% 视为可疑，
// 打印警告但不阻止 diff 生成——由 PR reviewer 判断。

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(process.cwd());
const CATALOG_PATH = resolve(
  REPO_ROOT,
  "src/main/services/usage-data/pricing-catalog.json"
);

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

// 只保留 chat 模式；embedding / audio / image / speech 等其它模式不适用于我们的
// token-based cost estimation。
const ALLOWED_MODES = new Set(["chat"]);

// 前缀过滤：跳过 provider-prefixed 变体（`bedrock/*`, `azure/*`, `openrouter/*`
// 等），它们通常和 canonical 上游同价，加进来只会污染目录。canonical vendor 命名
// 空间（`gpt-5`, `claude-*`, `deepseek-*` 等）会通过后续白名单接住。
const SKIP_PREFIXES = [
  "azure/",
  "azure_ai/",
  "bedrock/",
  "cerebras/",
  "codestral/",
  "cloudflare/",
  "cohere/",
  "cohere_chat/",
  "command-",
  "databricks/",
  "deepinfra/",
  "deepinfra_chat/",
  "fireworks_ai/",
  "friendliai/",
  "github/",
  "github_copilot/",
  "groq/",
  "huggingface/",
  "hyperbolic/",
  "luminous-",
  "mistral/",
  "nvidia/",
  "nvidia_nim/",
  "ollama/",
  "openai/",
  "openrouter/",
  "palm/",
  "perplexity/",
  "predibase/",
  "replicate/",
  "sagemaker/",
  "snowflake/",
  "text-",
  "together_ai/",
  "vertex_ai/",
  "watsonx/",
  "xinference/",
];

// 少数厂商在 LiteLLM 里只以 provider-prefixed 形式存在（没有独立的 canonical
// 顶层键）。这些前缀允许通过，脚本会剥掉 provider 前缀转成 canonical id。
// 例：`volcengine/doubao-seed-2-0-pro-260215` → `doubao-seed-2-0-pro-260215`。
const UNPREFIX_MAP = [
  { prefix: "volcengine/", replacement: "" },
  { prefix: "novita/baichuan/", replacement: "baichuan-" },
  // xAI only ships as `xai/grok-*` in LiteLLM; peel to canonical `grok-*`.
  { prefix: "xai/", replacement: "" },
];

// OpenRouter fill-missing：只信这些 provider 的 chat 模型，避免 marketplace
// 短别名（`gpt` / `grok`）污染目录。
const OPENROUTER_FILL_PROVIDERS = new Set([
  "anthropic",
  "deepseek",
  "google",
  "meta-llama",
  "minimax",
  "mistralai",
  "moonshotai",
  "openai",
  "qwen",
  "x-ai",
  "z-ai",
]);

export function canFillFromOpenRouter(openRouterId, canonical) {
  const provider = openRouterId.split("/")[0] ?? "";
  if (!OPENROUTER_FILL_PROVIDERS.has(provider)) return false;
  // 要求至少一位数字（版本/尺寸），拒绝 `gpt` / `claude-sonnet` 这类裸名。
  if (!/\d/.test(canonical)) return false;
  if (shouldInclude(canonical, { mode: "chat" })) return true;
  for (const prefix of CHAT_KEY_PREFIXES) {
    if (canonical.startsWith(prefix)) return true;
  }
  return false;
}


function tryUnprefix(rawKey) {
  for (const rule of UNPREFIX_MAP) {
    if (rawKey.startsWith(rule.prefix)) {
      const tail = rawKey.slice(rule.prefix.length);
      return rule.replacement + tail;
    }
  }
  return null;
}

// LiteLLM 里国内厂商 provider 命名可能形式各异。用 provider 白名单 + 键前缀识别
// 双重命中（有些 entry 只有 `deepseek-chat` 没有 provider 字段）。
const CHAT_KEY_PREFIXES = [
  // OpenAI 系
  "gpt-",
  "chatgpt-",
  "o1-",
  "o3-",
  "o4-",
  // Anthropic
  "claude-",
  // Google
  "gemini-",
  // xAI
  "grok-",
  // DeepSeek
  "deepseek-",
  "deepseek/",
  // Moonshot / Kimi
  "moonshot-",
  "moonshot/",
  "kimi-",
  // Alibaba Qwen
  "qwen-",
  "qwen2-",
  "qwen2.5-",
  "qwen3-",
  "qwq-",
  "qvq-",
  "dashscope/",
  // Zhipu / GLM
  "glm-",
  "zai/",
  "z-ai/",
  // ByteDance Doubao
  "doubao-",
  "volcengine/",
  // MiniMax
  "abab",
  "minimax-",
  "minimax/",
  // Yi (01.AI)
  "yi-",
  // Baichuan
  "baichuan",
  // Mistral (canonical)
  "mistral-",
  "codestral-",
  "magistral-",
  // Meta Llama (public inference)
  "llama-3",
  "llama-4",
];

export function shouldInclude(modelKey, entry) {
  if (!ALLOWED_MODES.has(entry.mode)) return false;
  // UNPREFIX_MAP 命中的 vendor-only 前缀直接放行（比 skip-prefix 优先）。
  if (UNPREFIX_MAP.some((rule) => modelKey.startsWith(rule.prefix))) {
    return true;
  }
  for (const skip of SKIP_PREFIXES) {
    if (modelKey.startsWith(skip)) return false;
  }
  for (const prefix of CHAT_KEY_PREFIXES) {
    if (modelKey.startsWith(prefix)) return true;
  }
  return false;
}

// `-latest` 是浮动别名，应归入基础模型；日期版本是独立费率身份，必须保留。
function stripLatestSuffix(modelId) {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/-latest$/, "");
}

function stripVendorPrefix(rawKey) {
  return rawKey.includes("/") ? rawKey.split("/").pop() : rawKey;
}

export function catalogKeyFor(rawKey) {
  const unprefixed = tryUnprefix(rawKey);
  const noVendor = unprefixed === null ? stripVendorPrefix(rawKey) : unprefixed;
  return stripLatestSuffix(noVendor);
}

function toMicrousd(usdPerToken) {
  if (typeof usdPerToken !== "number" || !Number.isFinite(usdPerToken)) {
    return null;
  }
  // usd_per_token * 1_000_000 = microusd_per_token；对齐 catalog schema 的整数
  // 舍入策略（parseFloat + toFixed(4)）保留 4 位有效数字，够小的费率也能表示。
  return Number.parseFloat((usdPerToken * 1_000_000).toFixed(4));
}

function fallbackCachedInput(inputMicrousd) {
  // LiteLLM 未提供 cache read 时按厂商惯例 10% 折扣（Anthropic / OpenAI / DeepSeek
  // 大致都是这个系数）；催真值以 LiteLLM 显式字段为准，脚本只填兜底。
  return Number.parseFloat((inputMicrousd * 0.1).toFixed(4));
}

// 从 LiteLLM entry 派生一个 pricing catalog entry（不含 aliases / priority）。
function normalizeEntry(entry) {
  const input = toMicrousd(entry.input_cost_per_token);
  const output = toMicrousd(entry.output_cost_per_token);
  if (input === null || output === null) return null;
  const cachedInput =
    toMicrousd(entry.cache_read_input_token_cost) ?? fallbackCachedInput(input);
  const normalized = {
    cachedInputMicrousd: cachedInput,
    inputMicrousd: input,
    outputMicrousd: output,
  };
  const longContextInput =
    toMicrousd(entry.input_cost_per_token_above_200k_tokens) ??
    toMicrousd(entry.input_cost_per_token_above_128k_tokens);
  if (longContextInput !== null) {
    const threshold = entry.input_cost_per_token_above_200k_tokens
      ? 200_000
      : 128_000;
    const longOutput =
      toMicrousd(entry.output_cost_per_token_above_200k_tokens) ??
      toMicrousd(entry.output_cost_per_token_above_128k_tokens) ??
      output;
    const longCached =
      toMicrousd(entry.cache_read_input_token_cost_above_200k_tokens) ??
      toMicrousd(entry.cache_read_input_token_cost_above_128k_tokens) ??
      fallbackCachedInput(longContextInput);
    normalized.longContext = {
      cachedInputMicrousd: longCached,
      inputMicrousd: longContextInput,
      outputMicrousd: longOutput,
      threshold,
    };
  }
  return normalized;
}

/**
 * OpenRouter `/v1/models` → catalog entry. Used only to fill models LiteLLM
 * missed (or our filter dropped). Returns null when pricing is incomplete.
 */
export function openRouterModelToEntry(model) {
  const pricing = model?.pricing;
  if (!pricing || typeof pricing !== "object") return null;
  const input = toMicrousd(Number.parseFloat(String(pricing.prompt)));
  const output = toMicrousd(Number.parseFloat(String(pricing.completion)));
  if (input === null || output === null) return null;
  const cachedRaw = pricing.input_cache_read ?? pricing.input_cache_read_price;
  const cachedInput =
    cachedRaw === undefined || cachedRaw === null
      ? fallbackCachedInput(input)
      : (toMicrousd(Number.parseFloat(String(cachedRaw))) ??
        fallbackCachedInput(input));
  return {
    cachedInputMicrousd: cachedInput,
    inputMicrousd: input,
    outputMicrousd: output,
  };
}


async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "pier-update-model-pricing/1.0" },
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadCurrentCatalog() {
  const raw = await readFile(CATALOG_PATH, "utf8");
  return JSON.parse(raw);
}

function mergeEntry(currentEntry, litellmEntry) {
  const merged = { ...litellmEntry };
  if (!currentEntry) return merged;
  // 保留手工字段
  if (currentEntry.aliases) merged.aliases = currentEntry.aliases;
  if (currentEntry.priority) merged.priority = currentEntry.priority;
  // 保留手工的 longContext.priority / priority.longContext 组合（LiteLLM 只给
  // longContext 主体）
  if (currentEntry.longContext?.priority && merged.longContext) {
    merged.longContext.priority = currentEntry.longContext.priority;
  }
  return merged;
}

const SUSPICIOUS_RATIO_UP = 5;
const SUSPICIOUS_RATIO_DOWN = 0.2;

function priceRatio(next, prev) {
  if (prev === 0) return next === 0 ? 1 : Number.POSITIVE_INFINITY;
  return next / prev;
}

function isSuspicious(nextEntry, prevEntry) {
  if (!prevEntry) return false;
  const ratios = [
    priceRatio(nextEntry.inputMicrousd, prevEntry.inputMicrousd),
    priceRatio(nextEntry.outputMicrousd, prevEntry.outputMicrousd),
  ];
  return ratios.some(
    (r) => r >= SUSPICIOUS_RATIO_UP || r <= SUSPICIOUS_RATIO_DOWN
  );
}

function summariseChange(id, prevEntry, nextEntry) {
  const prevIn = prevEntry?.inputMicrousd ?? null;
  const prevOut = prevEntry?.outputMicrousd ?? null;
  const nextIn = nextEntry.inputMicrousd;
  const nextOut = nextEntry.outputMicrousd;
  return `- \`${id}\`: input ${prevIn ?? "—"} → ${nextIn} / output ${prevOut ?? "—"} → ${nextOut}`;
}

function buildDiffReport({ added, changed, unchanged, suspicious, skipped }) {
  const lines = [
    "# Model pricing update",
    "",
    `Generated at ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Added: **${added.length}**`,
    `- Changed: **${changed.length}**`,
    `- Unchanged: ${unchanged}`,
    `- LiteLLM entries skipped by filter: ${skipped}`,
    `- Suspicious price deltas (>= 5x up or <= 20% left): **${suspicious.length}**`,
    "",
  ];
  if (suspicious.length > 0) {
    lines.push("## ⚠️ Suspicious deltas (review carefully)");
    lines.push("");
    for (const entry of suspicious) lines.push(entry);
    lines.push("");
  }
  if (added.length > 0) {
    lines.push("## Added");
    lines.push("");
    for (const entry of added) lines.push(entry);
    lines.push("");
  }
  if (changed.length > 0) {
    lines.push("## Changed");
    lines.push("");
    for (const entry of changed) lines.push(entry);
    lines.push("");
  }
  return lines.join("\n");
}

function sortObjectKeys(record) {
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const sorted = {};
  for (const key of keys) sorted[key] = record[key];
  return sorted;
}

function equalEntries(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const args = process.argv.slice(2);
  const isDry = args.includes("--dry");
  const diffOutArg = args.find((a) => a.startsWith("--diff-out="));
  const diffOut = diffOutArg ? diffOutArg.split("=")[1] : null;

  console.error(`[pricing] fetching LiteLLM: ${LITELLM_URL}`);
  const litellmRaw = await fetchJson(LITELLM_URL);
  // sample_spec 是 LiteLLM 的自身模板，不是模型条目——从 rest 里挑出来。
  const { sample_spec: _sampleSpec, ...litellm } = litellmRaw;
  console.error(`[pricing] LiteLLM entries: ${Object.keys(litellm).length}`);

  console.error(`[pricing] fetching OpenRouter: ${OPENROUTER_URL}`);
  let openrouter = null;
  try {
    openrouter = await fetchJson(OPENROUTER_URL);
  } catch (err) {
    console.error(
      `[pricing] OpenRouter fetch failed (non-fatal): ${err.message}`
    );
  }

  const current = await loadCurrentCatalog();
  const currentModels = current.models ?? {};

  // 按 LiteLLM 的独立费率身份建立基座。日期版本单独保留；仅 `-latest`
  // 归入基础模型。再把上游未覆盖的本地条目搬回来。
  const nextModels = {};
  const added = [];
  const changed = [];
  const suspicious = [];
  let unchanged = 0;
  let skipped = 0;

  const rawKeysByCatalogKey = new Map();
  for (const [rawKey, entry] of Object.entries(litellm)) {
    if (!shouldInclude(rawKey, entry)) {
      skipped += 1;
      continue;
    }
    const catalogKey = catalogKeyFor(rawKey);
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    // 变体键归入目录键的 alias 集合。其它剥前缀
    // （`moonshot/kimi-k2.6` → `kimi-k2.6`）不需要
    // alias，因为 canonical 就是它。只有 `provider/some-model` 的 `provider/`
    // 前缀形式作为 alias 记录。
    const variants = rawKeysByCatalogKey.get(catalogKey) ?? new Set();
    if (rawKey !== catalogKey && rawKey.includes("/")) {
      variants.add(rawKey);
    }
    rawKeysByCatalogKey.set(catalogKey, variants);

    const prev = currentModels[catalogKey];
    const merged = mergeEntry(prev, normalized);
    nextModels[catalogKey] = merged;
  }
  // 应用累计 alias 到 nextModels
  for (const [catalogKey, variants] of rawKeysByCatalogKey) {
    if (variants.size === 0) continue;
    const entry = nextModels[catalogKey];
    if (!entry) continue;
    const aliases = new Set(entry.aliases ?? []);
    for (const alias of variants) aliases.add(alias);
    entry.aliases = [...aliases].sort();
  }
  // 保留 LiteLLM 未覆盖的手工条目和未来模型，包括独立的日期版本。
  for (const [key, entry] of Object.entries(currentModels)) {
    if (nextModels[key]) continue;
    nextModels[key] = entry;
  }
  // 计算 diff 报告
  for (const catalogKey of rawKeysByCatalogKey.keys()) {
    const next = nextModels[catalogKey];
    if (!next) continue;
    const prev = currentModels[catalogKey];
    if (!prev) {
      added.push(summariseChange(catalogKey, null, next));
    } else if (equalEntries(prev, next)) {
      unchanged += 1;
    } else {
      changed.push(summariseChange(catalogKey, prev, next));
      if (isSuspicious(next, prev)) {
        suspicious.push(summariseChange(catalogKey, prev, next));
      }
    }
  }

  // OpenRouter：
  // 1) 给已有 canonical 补 `provider/id` alias；
  // 2) LiteLLM 未入库的 chat 模型用 OR 价 fill-missing（不覆盖已有价）。
  let openRouterFilled = 0;
  if (Array.isArray(openrouter?.data)) {
    for (const model of openrouter.data) {
      const id = model.id;
      if (!id?.includes("/")) continue;
      const suffix = id.split("/").slice(1).join("/");
      const canonical = stripLatestSuffix(suffix.split(":")[0]);
      if (!canonical) continue;
      const target = nextModels[canonical];
      if (target) {
        const aliases = new Set(target.aliases ?? []);
        aliases.add(id);
        target.aliases = [...aliases].sort();
        continue;
      }
      // fill-missing：LiteLLM 无此 canonical 时，仅对可信 provider + 带版本号 id 写入。
      if (!canFillFromOpenRouter(id, canonical)) {
        continue;
      }
      const entry = openRouterModelToEntry(model);
      if (!entry) continue;
      nextModels[canonical] = {
        ...entry,
        aliases: [id],
      };
      added.push(
        summariseChange(canonical, null, entry) + " _(openrouter fill-missing)_"
      );
      openRouterFilled += 1;
    }
  }
  if (openRouterFilled > 0) {
    console.error(
      `[pricing] OpenRouter fill-missing entries: ${openRouterFilled}`
    );
  }

  const sortedModels = sortObjectKeys(nextModels);
  const nextCatalog = { ...current, models: sortedModels };
  const report = buildDiffReport({
    added,
    changed,
    unchanged,
    suspicious,
    skipped,
  });

  console.error(report);

  if (diffOut) {
    await writeFile(diffOut, report, "utf8");
    console.error(`[pricing] diff written to ${diffOut}`);
  }
  if (isDry) {
    console.error("[pricing] --dry: catalog not written");
    return;
  }
  await writeFile(
    CATALOG_PATH,
    `${JSON.stringify(nextCatalog, null, 2)}\n`,
    "utf8"
  );
  console.error(`[pricing] catalog written: ${CATALOG_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
