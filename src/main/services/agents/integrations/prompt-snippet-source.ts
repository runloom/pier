/**
 * 注入第三方 JS 插件的 prompt → promptSnippet 抽取（≤512）。
 * 供 omp / pi / amp / opencode / mimo-code 等直写 JSONL 的 PromptSubmit 使用。
 * 无顶层 import：与 writer-lock-source 一样嵌进模板字面量。
 */
export const JAVASCRIPT_PROMPT_SNIPPET_SOURCE = `
var PIER_PROMPT_KEYS = ["prompt", "user_prompt", "content", "message", "text", "input"];

function pierCoercePromptText(value) {
	if (typeof value === "string") {
		var trimmed = value.trim();
		return trimmed ? trimmed : undefined;
	}
	if (Array.isArray(value)) {
		var parts = [];
		for (var i = 0; i < value.length; i += 1) {
			var item = value[i];
			if (typeof item === "string" && item.trim()) parts.push(item.trim());
			else if (item && typeof item === "object") {
				var nested = pierReadPromptKeys(item);
				if (nested) parts.push(nested);
			}
		}
		if (parts.length) return parts.join(" ");
	}
	return undefined;
}

function pierReadPromptKeys(record) {
	if (!record || typeof record !== "object") return undefined;
	for (var i = 0; i < PIER_PROMPT_KEYS.length; i += 1) {
		var text = pierCoercePromptText(record[PIER_PROMPT_KEYS[i]]);
		if (text) return text;
	}
	return undefined;
}

function pierPromptFromSessionManager(manager) {
	if (!manager || typeof manager !== "object") return undefined;
	try {
		if (typeof manager.getLastUserMessage === "function") {
			var last = pierCoercePromptText(manager.getLastUserMessage());
			if (last) return last;
		}
	} catch {}
	try {
		if (typeof manager.getMessages === "function") {
			var messages = manager.getMessages();
			if (Array.isArray(messages)) {
				for (var i = messages.length - 1; i >= 0; i -= 1) {
					var msg = messages[i];
					if (!msg || typeof msg !== "object") continue;
					var role = msg.role || msg.type || msg.kind;
					if (role && role !== "user" && role !== "human") continue;
					var body = pierReadPromptKeys(msg) || pierCoercePromptText(msg.content);
					if (body) return body;
				}
			}
		}
	} catch {}
	return undefined;
}

function pierPromptSnippetFrom() {
	var values = Array.prototype.slice.call(arguments);
	for (var i = 0; i < values.length; i += 1) {
		var value = values[i];
		if (!value || typeof value !== "object") continue;
		var direct = pierReadPromptKeys(value);
		if (direct) return direct.slice(0, 512);
		if (value.properties && typeof value.properties === "object") {
			var fromProps = pierReadPromptKeys(value.properties);
			if (fromProps) return fromProps.slice(0, 512);
		}
		if (value.sessionManager) {
			var fromMgr = pierPromptFromSessionManager(value.sessionManager);
			if (fromMgr) return fromMgr.slice(0, 512);
		}
	}
	return undefined;
}
`;
